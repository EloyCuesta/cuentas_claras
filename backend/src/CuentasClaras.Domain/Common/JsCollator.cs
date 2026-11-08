using System.Globalization;

namespace CuentasClaras.Domain.Common;

/// <summary>
/// localeCompare de JavaScript con la colación «es» de ICU: la ñ después de la n, las tildes y las mayúsculas como
/// diferencias menores y los signos sin ignorar. Ordena categorías y totales del resumen (FIN-04) y los productos y las
/// personas de la despensa (PAN-01). Lo comprueba el corpus fixtures/migration/rules-finance.json contra Node.
/// Necesita la globalización de ICU (la de Windows 10 1903 en adelante, o la de Linux); en modo invariante .NET
/// compararía por códigos y el corpus lo detectaría.
/// </summary>
public static class JsCollator
{
    private static readonly CompareInfo Spanish = CultureInfo.GetCultureInfo("es").CompareInfo;

    /// <summary>{ sensitivity: 'base' }: solo cuentan las letras, sin mayúsculas ni tildes.</summary>
    private const CompareOptions BaseOptions =
        CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace | CompareOptions.IgnoreKanaType | CompareOptions.IgnoreWidth;

    /// <summary>a.localeCompare(b, 'es'): -1, 0 o 1.</summary>
    public static int Compare(string a, string b) => Math.Sign(Spanish.Compare(a, b, CompareOptions.None));

    /// <summary>a.localeCompare(b, 'es', { sensitivity: 'base' }): -1, 0 o 1.</summary>
    public static int CompareBase(string a, string b) => Math.Sign(Spanish.Compare(a, b, BaseOptions));
}
