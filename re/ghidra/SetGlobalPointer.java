// Pre-script: gives the decompiler the program's global pointer. Most mode programs (TITLE,
// SELECT, SW_ON, ...) set $gp in `start` (lui gp / addiu gp just before the jump to main) and
// address their small globals as gp+offset. Without the value, Ghidra reads those as low RAM
// (iRam00000068) and every such global is lost. PAZLE.EXE doesn't use $gp, so this is a no-op
// there. Finds the pair in the 64 bytes at the entry point and sets gp over all memory.
// Usage: -preScript SetGlobalPointer.java
// @category TetrisPlus

import java.math.BigInteger;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.lang.Register;
import ghidra.program.model.mem.MemoryBlock;

public class SetGlobalPointer extends GhidraScript {

	@Override
	public void run() throws Exception {
		Address entry = null;
		for (Address a : currentProgram.getSymbolTable().getExternalEntryPointIterator()) {
			entry = a;
		}
		if (entry == null) {
			println("SetGlobalPointer: no entry point");
			return;
		}
		long hi = -1;
		long gp = -1;
		for (int i = 0; i < 64; i += 4) {
			int w = getInt(entry.add(i));
			int op = w >>> 26;
			int rt = (w >>> 16) & 31;
			int rs = (w >>> 21) & 31;
			if (op == 0x0f && rt == 28) {
				hi = ((long) (w & 0xffff)) << 16;
			} else if (op == 0x09 && rt == 28 && rs == 28 && hi >= 0) {
				gp = (hi + (short) (w & 0xffff)) & 0xffffffffL;
			}
		}
		if (gp < 0) {
			println("SetGlobalPointer: no gp set at the entry point");
			return;
		}
		Register reg = currentProgram.getRegister("gp");
		for (MemoryBlock b : currentProgram.getMemory().getBlocks()) {
			currentProgram.getProgramContext().setValue(reg, b.getStart(), b.getEnd(), BigInteger.valueOf(gp));
		}
		println(String.format("SetGlobalPointer: gp = 0x%08x", gp));
	}
}
