#!/usr/bin/env python3
"""Print the state-machine dispatch tree of a program from its decompiled C.

The Natsume code dispatches state machines the same way everywhere: copy a table of function
pointers from the read-only area to the stack, then call `table[some state variable]`. This finds
every such dispatcher in an ExportDecompiled.java dump, reads its table out of the EXE (the table
length is taken from the stack copy size), and prints the tree from a root function. Direct calls
are followed too, but only into functions that lead to another dispatcher ("calls" lines).

Usage: dispatch_tree.py EXE DECOMPILED.c ROOT_ADDRESS [--names NAMES.tsv]

NAMES.tsv (address<TAB>function<TAB>name, like re/symbols/*.tsv) replaces FUN_ labels.
"""

import argparse
import re
import struct

HEADER = 0x800


def load_exe(path):
    data = open(path, "rb").read()
    t_addr, t_size = struct.unpack_from("<II", data, 0x18)
    return t_addr, data[HEADER:HEADER + t_size]


def split_functions(path):
    functions, current = {}, None
    for line in open(path, encoding="utf-8"):
        match = re.match(r"//==== ([0-9a-f]{8}) (\S+)", line)
        if match:
            current = int(match.group(1), 16)
            functions[current] = {"name": match.group(2), "body": []}
        elif current is not None:
            functions[current]["body"].append(line)
    for function in functions.values():
        function["body"] = "".join(function["body"])
    return functions


def find_dispatch(body, base, text):
    """Return (table address, entry count, index expression) or None."""
    call = re.search(r"\(\*\(code \*\)local_\w+\[(.+?)\]\)\(", body)
    if not call:
        return None

    def is_code_pointer(address):
        if not base <= address < base + len(text) - 3:
            return False
        (word,) = struct.unpack_from("<I", text, address - base)
        return base <= word < base + len(text)

    # The first table word copied: PTR_FUN_800942e0, PTR_LAB_..., DAT_... or &PTR_FUN_... for loop
    # copies. Other globals (the player index, state) can appear first, so check what it holds.
    first = next((m for m in re.finditer(r"(?:PTR_(?:FUN|LAB|DAT)_|DAT_)([0-9a-f]{8})", body)
                  if is_code_pointer(int(m.group(1), 16))), None)
    if not first:
        return None
    start = int(first.group(1), 16)
    estimates = [0]
    # The stack array the call indexes, when it holds the whole table.
    called = re.search(r"\(\*\(code \*\)(local_\w+)\[", body).group(1)
    declared = re.search(called + r" \[(\d+)\]", body)
    if declared:
        estimates.append(int(declared.group(1)))
    # Unrolled copies: table words copied to locals, contiguous from the first one.
    copied = {int(m, 16) for m in re.findall(
        r"local_\w+(?:\[\d+\])? = (?:\([\w ]+\*\))?(?:PTR_(?:FUN|LAB|DAT)_|DAT_)([0-9a-f]{8});", body)}
    count = 0
    while start + 4 * count in copied:
        count += 1
    estimates.append(count)
    # Loop copies stop at "!= &PTR_FUN_<end>" (or a cast &DAT_<end>); tail words follow the loop.
    loop_end = re.search(r"!= (?:\([\w *]+\))?&(?:PTR_\w+?|DAT)_([0-9a-f]{8})\)", body)
    if loop_end:
        tail = len(re.findall(r"puVar\d+\[\d\] = ", body.split("while", 1)[-1]))
        estimates.append((int(loop_end.group(1), 16) - start) // 4 + tail)
    count = max(estimates)
    # A larger stack array can hold other locals after the table: stop at the first non-pointer.
    for i in range(count):
        if not is_code_pointer(start + 4 * i):
            count = i
            break
    return int(first.group(1), 16), count, call.group(1)


def simplify(expression):
    expression = re.sub(r"\*\(int \*\)\((.+?)\)", r"[\1]", expression)
    expression = expression.replace("DAT_800ed328", "state").replace("DAT_8003e668", "state")
    return expression


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("exe")
    parser.add_argument("decompiled")
    parser.add_argument("root", type=lambda s: int(s, 16))
    parser.add_argument("--names")
    args = parser.parse_args()

    base, text = load_exe(args.exe)
    functions = split_functions(args.decompiled)
    names = {}
    if args.names:
        for line in open(args.names, encoding="utf-8"):
            if line.strip() and not line.startswith("#"):
                address, _, name = line.rstrip("\n").split("\t")[:3]
                names[int(address, 16)] = name

    def label(address):
        name = names.get(address) or functions.get(address, {}).get("name", "?")
        return f"{address:08x} {name}"

    def callees(address):
        body = functions.get(address, {}).get("body", "")
        found = []
        for match in re.findall(r"FUN_([0-9a-f]{8})\(", body):
            callee = int(match, 16)
            if callee != address and callee not in found:
                found.append(callee)
        return found

    leads = {}

    def leads_to_dispatch(address, stack=()):
        if address in leads:
            return leads[address]
        if address in stack or address not in functions:
            return False
        result = find_dispatch(functions[address]["body"], base, text) is not None or any(
            leads_to_dispatch(callee, stack + (address,)) for callee in callees(address))
        leads[address] = result
        return result

    seen = set()

    def walk(address, depth, prefix):
        print(f"{'  ' * depth}{prefix}{label(address)}")
        if address in seen:
            return
        seen.add(address)
        function = functions.get(address)
        if not function:
            return
        for callee in callees(address):
            if leads_to_dispatch(callee):
                walk(callee, depth + 1, "calls ")
        found = find_dispatch(function["body"], base, text)
        if not found:
            return
        table, count, index = found
        print(f"{'  ' * (depth + 1)}dispatch on {simplify(index)}, table 0x{table:08x} x {count}")
        for i in range(count or 0):
            (target,) = struct.unpack_from("<I", text, table - base + 4 * i)
            walk(target, depth + 2, f"[{i}] ")

    walk(args.root, 0, "")


if __name__ == "__main__":
    main()
