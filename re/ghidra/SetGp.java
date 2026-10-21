// Pre-script: sets the MIPS global pointer ($gp) for the whole program, for EXEs whose header
// leaves gp0 at 0. Without it every gp-relative global decompiles as iRam000000NN (an offset
// from address 0). The value is each program's gp (docs/re/shell.md §5).
// Usage: -preScript SetGp.java 0x800B421C
// @category TetrisPlus

import java.math.BigInteger;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.ProgramContext;
import ghidra.program.model.mem.MemoryBlock;

public class SetGp extends GhidraScript {

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length != 1) {
			throw new IllegalArgumentException("expected: <gp value>");
		}
		BigInteger gp = new BigInteger(args[0].replaceFirst("^0[xX]", ""), 16);
		ProgramContext context = currentProgram.getProgramContext();
		Register reg = context.getRegister("gp");
		for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
			if (block.isInitialized()) {
				context.setValue(reg, block.getStart(), block.getEnd(), gp);
			}
		}
		println("SetGp: gp = 0x" + gp.toString(16));
	}
}
