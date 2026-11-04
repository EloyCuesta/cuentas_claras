namespace CuentasClaras.Api.Auth;

/// <summary>Contrato literal de la cookie; la primera coincidencia gana y nunca se decodifica como URL.</summary>
public static class SessionCookie
{
    public static string? Read(string header)
    {
        foreach (var part in header.Split(';'))
        {
            var separator = part.IndexOf('=');
            if (separator < 0 || Trim(part[..separator]) != "cc_sesion") continue;
            var value = Trim(part[(separator + 1)..]);
            return value.Length == 64 && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f') ? value : null;
        }
        return null;
    }

    public static string Set(string token) => $"cc_sesion={token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=43200";
    public static string Clear => "cc_sesion=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0";

    private static string Trim(string value) => value.Trim('\u0009', '\u000a', '\u000b', '\u000c', '\u000d',
        '\u0020', '\u00a0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005',
        '\u2006', '\u2007', '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff');
}
