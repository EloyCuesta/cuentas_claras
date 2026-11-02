using System.Reflection;
using System.Reflection.Emit;

namespace CuentasClaras.Tests;

/// <summary>
/// Lee dependencias reales de firmas y cuerpos compilados, incluidos genéricos y clases generadas por async.
/// No depende de expresiones regulares sobre using: también ve nombres cualificados y llamadas dentro de métodos.
/// </summary>
internal static class CompiledDependencies
{
    private const BindingFlags Declared = BindingFlags.Public | BindingFlags.NonPublic |
        BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;
    private static readonly Dictionary<short, OpCode> Codes = typeof(OpCodes)
        .GetFields(BindingFlags.Public | BindingFlags.Static)
        .Where(field => field.FieldType == typeof(OpCode))
        .Select(field => (OpCode)field.GetValue(null)!)
        .ToDictionary(code => code.Value);

    public static IReadOnlySet<Type> Of(Type type)
    {
        var found = new HashSet<Type>();
        AddType(type.BaseType, found);
        foreach (var contract in type.GetInterfaces()) AddType(contract, found);
        foreach (var argument in type.GetGenericArguments()) AddType(argument, found);
        AddAttributes(type, found);
        foreach (var field in type.GetFields(Declared))
        {
            AddType(field.FieldType, found);
            AddAttributes(field, found);
        }
        foreach (var property in type.GetProperties(Declared))
        {
            AddType(property.PropertyType, found);
            AddAttributes(property, found);
        }
        foreach (var item in type.GetEvents(Declared))
        {
            AddType(item.EventHandlerType, found);
            AddAttributes(item, found);
        }
        foreach (var method in type.GetMethods(Declared).Cast<MethodBase>().Concat(type.GetConstructors(Declared)))
        {
            AddMember(method, found);
            AddAttributes(method, found);
            var body = method.GetMethodBody();
            if (body is null) continue;
            foreach (var local in body.LocalVariables) AddType(local.LocalType, found);
            foreach (var clause in body.ExceptionHandlingClauses)
                if (clause.Flags == ExceptionHandlingClauseOptions.Clause) AddType(clause.CatchType, found);
            ReadBody(method, body.GetILAsByteArray() ?? [], found);
        }
        found.Remove(type);
        return found;
    }

    private static void AddType(Type? type, HashSet<Type> found)
    {
        if (type is null || !found.Add(type)) return;
        if (type.HasElementType) AddType(type.GetElementType(), found);
        if (type.IsGenericType)
        {
            AddType(type.GetGenericTypeDefinition(), found);
            foreach (var argument in type.GetGenericArguments()) AddType(argument, found);
        }
        if (type.IsGenericParameter)
            foreach (var constraint in type.GetGenericParameterConstraints()) AddType(constraint, found);
    }

    private static void AddMember(MemberInfo? member, HashSet<Type> found)
    {
        if (member is null) return;
        AddType(member.DeclaringType, found);
        switch (member)
        {
            case Type type:
                AddType(type, found);
                break;
            case FieldInfo field:
                AddType(field.FieldType, found);
                break;
            case MethodBase method:
                foreach (var parameter in method.GetParameters()) AddType(parameter.ParameterType, found);
                if (method is MethodInfo info)
                {
                    AddType(info.ReturnType, found);
                    foreach (var argument in info.GetGenericArguments()) AddType(argument, found);
                }
                break;
        }
    }

    private static void AddAttributes(MemberInfo member, HashSet<Type> found)
    {
        foreach (var attribute in member.GetCustomAttributesData())
        {
            AddType(attribute.AttributeType, found);
            foreach (var argument in attribute.ConstructorArguments) AddAttributeArgument(argument, found);
            foreach (var argument in attribute.NamedArguments) AddAttributeArgument(argument.TypedValue, found);
        }
    }

    private static void AddAttributeArgument(CustomAttributeTypedArgument argument, HashSet<Type> found)
    {
        AddType(argument.ArgumentType, found);
        if (argument.Value is Type type) AddType(type, found);
        if (argument.Value is IEnumerable<CustomAttributeTypedArgument> values)
            foreach (var value in values) AddAttributeArgument(value, found);
    }

    private static void ReadBody(MethodBase method, byte[] bytes, HashSet<Type> found)
    {
        var offset = 0;
        while (offset < bytes.Length)
        {
            var first = bytes[offset++];
            var code = Codes[first == 0xfe ? unchecked((short)(0xfe00 | bytes[offset++])) : first];
            switch (code.OperandType)
            {
                case OperandType.InlineField:
                case OperandType.InlineMethod:
                case OperandType.InlineType:
                case OperandType.InlineTok:
                    var token = BitConverter.ToInt32(bytes, offset);
                    AddMember(method.Module.ResolveMember(token, method.DeclaringType?.GetGenericArguments(),
                        method.IsGenericMethod ? method.GetGenericArguments() : null), found);
                    offset += 4;
                    break;
                case OperandType.InlineNone:
                    break;
                case OperandType.ShortInlineBrTarget:
                case OperandType.ShortInlineI:
                case OperandType.ShortInlineVar:
                    offset += 1;
                    break;
                case OperandType.InlineVar:
                    offset += 2;
                    break;
                case OperandType.InlineBrTarget:
                case OperandType.InlineI:
                case OperandType.InlineString:
                case OperandType.ShortInlineR:
                    offset += 4;
                    break;
                case OperandType.InlineI8:
                case OperandType.InlineR:
                    offset += 8;
                    break;
                case OperandType.InlineSwitch:
                    offset += 4 + 4 * BitConverter.ToInt32(bytes, offset);
                    break;
                default:
                    throw new InvalidOperationException($"Operando IL no cubierto en {method}: {code.OperandType}");
            }
        }
    }
}
