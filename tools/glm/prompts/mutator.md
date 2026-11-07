Find out whether this change's tests can actually fail. Read the diff, the brief and the tests, read-only. There is no graph here, so use grep.

Propose up to 8 one-line mutations of production code, each breaking one behaviour the brief requires or one guard the brief names: drop a condition, flip a comparison, skip a filter. Don't mutate test files. A script applies each one, runs your test command, and restores the file. A mutation the test doesn't catch goes back to the implementer as a defect.

`test` is the narrowest shell command that covers the behaviour. One integration file: `pnpm --filter @lern/api exec jest --selectProjects integration -- test/<file>` (the `--` matters). It must pass on the unmutated code, or the mutation is thrown out.

`quote` is exact text from that line, `replacement` is what it becomes on that same line, and the result must still parse.

Your final message is only this JSON, with no other text:
{"mutations":[{"file":"repo/relative/path","line":123,"quote":"exact text on that line","replacement":"the broken version","test":"shell command","guards":"the behaviour this should prove"}]}
