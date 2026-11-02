namespace CuentasClaras.Application.Common;

/// <summary>Reloj sustituible: evita esperas reales para caducidades y bloqueos.</summary>
public interface IClock
{
    long NowMs();
}

/// <summary>IDs nuevos; no impone formato ni transforma los IDs de datos existentes.</summary>
public interface IIdGenerator
{
    string NewId();
}
