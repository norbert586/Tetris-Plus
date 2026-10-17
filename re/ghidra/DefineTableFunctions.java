// Finds functions that no direct call reaches and defines them, so later exports cover the whole
// program. Auto-analysis misses two kinds:
//   1. Targets of pointer tables (state-machine dispatch). Every aligned word in initialised memory
//      that points at an instruction-aligned address inside the code range, and not inside an
//      existing function's body, becomes a function. Switch tables are left alone because their
//      targets already sit inside a function.
//   2. Code in the gaps between functions: callbacks whose address is built with lui/addiu, and
//      unused functions. In each gap a function starts at the first non-zero word and after each
//      "jr ra" plus its delay slot.
// Analysis runs again after each pass, which can expose more direct callees; this repeats until
// nothing new is found. Each function created from a gap is printed as "gap function <address>".
//
// Writes one line per table word that targets code (defined or already known) to the output:
//   P <word address> <target> <function at target, or "inside:<containing function>">
// Usage: -postScript DefineTableFunctions.java <code start> <code end> <output.tsv>
// @category TetrisPlus

import java.io.File;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;

import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;

public class DefineTableFunctions extends GhidraScript {

	@Override
	public void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length != 3) {
			throw new IllegalArgumentException("expected: <code start> <code end> <output.tsv>");
		}
		long codeStart = Long.parseUnsignedLong(args[0].replace("0x", ""), 16);
		long codeEnd = Long.parseUnsignedLong(args[1].replace("0x", ""), 16);
		Memory memory = currentProgram.getMemory();

		int created = 0;
		for (int pass = 1; pass <= 10; pass++) {
			int createdThisPass = 0;
			for (Address target : scan(memory, codeStart, codeEnd).values()) {
				if (getFunctionContaining(target) != null) {
					continue;
				}
				if (getInstructionAt(target) == null) {
					new DisassembleCommand(target, null, true).applyTo(currentProgram, monitor);
				}
				if (getInstructionAt(target) != null &&
					new CreateFunctionCmd(target).applyTo(currentProgram, monitor)) {
					createdThisPass++;
				}
			}
			for (Address start : gapStarts(memory, codeStart, codeEnd)) {
				if (getFunctionContaining(start) != null) {
					continue;
				}
				new DisassembleCommand(start, null, true).applyTo(currentProgram, monitor);
				if (getInstructionAt(start) != null &&
					new CreateFunctionCmd(start).applyTo(currentProgram, monitor)) {
					println("DefineTableFunctions: gap function " + start);
					createdThisPass++;
				}
			}
			created += createdThisPass;
			println("DefineTableFunctions: pass " + pass + " created " + createdThisPass);
			if (createdThisPass == 0) {
				break;
			}
			analyzeChanges(currentProgram);
		}

		try (PrintWriter out = new PrintWriter(new File(args[2]), "UTF-8")) {
			for (var entry : scan(memory, codeStart, codeEnd).entrySet()) {
				Address target = entry.getValue();
				Function at = getFunctionAt(target);
				Function inside = getFunctionContaining(target);
				String what = at != null ? at.getName()
					: inside != null ? "inside:" + inside.getName() : "none";
				out.printf("P\t%s\t%s\t%s%n", entry.getKey(), target, what);
			}
		}
		println("DefineTableFunctions: created " + created + " functions in total");
	}

	/** Candidate function starts in the code range that lie outside every function body. */
	private List<Address> gapStarts(Memory memory, long codeStart, long codeEnd) throws Exception {
		List<Address> starts = new ArrayList<>();
		boolean expectStart = true;
		for (long at = codeStart; at < codeEnd; at += 4) {
			Address address = toAddr(at);
			if (getFunctionContaining(address) != null) {
				expectStart = true;
				continue;
			}
			int word = memory.getInt(address);
			if (word == 0) {
				continue;
			}
			if (expectStart) {
				starts.add(address);
				expectStart = false;
			}
			if (word == 0x03e00008) {
				at += 4;
				expectStart = true;
			}
		}
		return starts;
	}

	/** Word address -> code address it points at, for every aligned word pointing into the code range. */
	private TreeMap<Address, Address> scan(Memory memory, long codeStart, long codeEnd) throws Exception {
		TreeMap<Address, Address> found = new TreeMap<>();
		for (MemoryBlock block : memory.getBlocks()) {
			if (!block.isInitialized()) {
				continue;
			}
			AddressSet range = new AddressSet(block.getStart(), block.getEnd());
			Address at = block.getStart();
			while (at != null && range.contains(at.add(3))) {
				long value = memory.getInt(at) & 0xffffffffL;
				if (value >= codeStart && value < codeEnd && (value & 3) == 0) {
					found.put(at, toAddr(value));
				}
				at = at.add(4);
			}
		}
		return found;
	}
}
