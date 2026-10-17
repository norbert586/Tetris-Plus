// Writes the decompiled C of every function in the program to one text file, in address order,
// each headed by its address, name and callers. Grep-friendly companion to REA for surveys that
// span a whole executable (finding loaders, CD calls, table users) without one REA call per function.
// Usage: -postScript ExportDecompiled.java <output.c>
// @category TetrisPlus

import java.io.File;
import java.io.PrintWriter;
import java.util.stream.Collectors;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;

public class ExportDecompiled extends GhidraScript {

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length != 1) {
			throw new IllegalArgumentException("expected one argument: output path");
		}
		DecompInterface decompiler = new DecompInterface();
		decompiler.openProgram(currentProgram);
		int written = 0;
		try (PrintWriter out = new PrintWriter(new File(args[0]), "UTF-8")) {
			for (Function function : currentProgram.getFunctionManager().getFunctions(true)) {
				if (monitor.isCancelled()) {
					break;
				}
				String callers = function.getCallingFunctions(monitor).stream()
					.map(f -> f.getName() + "@" + f.getEntryPoint())
					.sorted().collect(Collectors.joining(", "));
				out.printf("//==== %s %s  callers: %s%n", function.getEntryPoint(), function.getName(), callers);
				DecompileResults result = decompiler.decompileFunction(function, 60, monitor);
				out.println(result.decompileCompleted()
					? result.getDecompiledFunction().getC()
					: "// decompilation failed: " + result.getErrorMessage());
				written++;
			}
		}
		decompiler.dispose();
		println("ExportDecompiled: wrote " + written + " functions to " + args[0]);
	}
}
