namespace MiniProject;

internal static class Program
{
    private static string Greet(string name) => $"Hello, {name}!";

    private static void Main() => Console.WriteLine(Greet(42));
}
