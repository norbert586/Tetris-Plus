// Exports every non-default function name as REA seed lines (address<TAB>function<TAB>name).
// Run headless after ghidra_psx_ldr's PSX loader and PsyQ signature analyzer have named the
// Sony library code, so REA sessions on the ELF wrapper start with the same names.
// Usage: -postScript ExportFunctionNames.java <output.tsv>
// @category TetrisPlus

import java.io.File;
import java.io.PrintWriter;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;

public class ExportFunctionNames extends GhidraScript {

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length != 1) {
			throw new IllegalArgumentException("expected one argument: output path");
		}
		int written = 0;
		try (PrintWriter out = new PrintWriter(new File(args[0]), "UTF-8")) {
			out.printf("# %s: function names from %s (PsyQ signatures + analysis)%n",
				currentProgram.getName(), currentProgram.getExecutableFormat());
			for (Function function : currentProgram.getFunctionManager().getFunctions(true)) {
				if (function.getSymbol().getSource() == SourceType.DEFAULT) {
					continue;
				}
				out.printf("0x%s\tfunction\t%s%n",
					function.getEntryPoint().toString().toLowerCase(), function.getName());
				written++;
			}
		}
		println("ExportFunctionNames: wrote " + written + " names to " + args[0]);
	}
}
