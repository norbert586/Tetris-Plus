// Writes every function's extent and every direct call edge as TSV, for call-graph notes and for
// bounding which address ranges hold game code versus PsyQ library code.
//   F <entry> <name> <first address> <last address> <body bytes>
//   C <caller entry> <call site> <callee entry> <callee name>
//   I <caller entry> <call site>                  (indirect call: jalr)
// Usage: -postScript ExportCallGraph.java <output.tsv>
// @category TetrisPlus

import java.io.File;
import java.io.PrintWriter;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.AddressSetView;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.symbol.FlowType;
import ghidra.program.model.symbol.Reference;

public class ExportCallGraph extends GhidraScript {

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length != 1) {
			throw new IllegalArgumentException("expected one argument: output path");
		}
		int functions = 0, edges = 0;
		try (PrintWriter out = new PrintWriter(new File(args[0]), "UTF-8")) {
			for (Function function : currentProgram.getFunctionManager().getFunctions(true)) {
				AddressSetView body = function.getBody();
				out.printf("F\t%s\t%s\t%s\t%s\t%d%n", function.getEntryPoint(), function.getName(),
					body.getMinAddress(), body.getMaxAddress(), body.getNumAddresses());
				functions++;
				for (Instruction insn : currentProgram.getListing().getInstructions(body, true)) {
					FlowType flow = insn.getFlowType();
					if (!flow.isCall()) {
						continue;
					}
					boolean resolved = false;
					for (Reference ref : insn.getReferencesFrom()) {
						if (!ref.getReferenceType().isCall()) {
							continue;
						}
						Function callee = getFunctionAt(ref.getToAddress());
						out.printf("C\t%s\t%s\t%s\t%s%n", function.getEntryPoint(), insn.getAddress(),
							ref.getToAddress(), callee == null ? "?" : callee.getName());
						resolved = true;
						edges++;
					}
					if (!resolved) {
						out.printf("I\t%s\t%s%n", function.getEntryPoint(), insn.getAddress());
					}
				}
			}
		}
		println("ExportCallGraph: " + functions + " functions, " + edges + " call edges to " + args[0]);
	}
}
