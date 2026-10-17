// Pre-script: turns on Ghidra's "Decompiler Parameter ID" analyzer, which infers each function's
// parameters from its body and its callers. Without it the decompiler drops arguments a caller
// passes straight through (for example FUN_80098658 forwarding a0-a3 to FUN_800985b4), so calls
// read as f() although the code passes values. Slower: adds a few minutes to a whole-EXE import.
// Usage: -preScript EnableParamId.java
// @category TetrisPlus

import java.util.Map;

import ghidra.app.script.GhidraScript;

public class EnableParamId extends GhidraScript {

	@Override
	public void run() throws Exception {
		Map<String, String> options = getCurrentAnalysisOptionsAndValues(currentProgram);
		if (!options.containsKey("Decompiler Parameter ID")) {
			throw new IllegalStateException("analyzer 'Decompiler Parameter ID' not found");
		}
		setAnalysisOption(currentProgram, "Decompiler Parameter ID", "true");
		println("EnableParamId: Decompiler Parameter ID on");
	}
}
