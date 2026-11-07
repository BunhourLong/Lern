A senior engineer will judge this change with very little time. Read the diff and the real files, read-only, then map each numbered requirement in the brief to the code that meets it. There is no graph here, so use grep.

Cite the one line that matters most for each requirement, plus any line where the logic is subtle: a guard, a timer, an ordering rule, a boundary check. A script cuts the code around each citation from the real file, and it shows in full every changed production hunk you don't cite, so don't try to summarise code. If a requirement isn't met, leave it out: a script reports the gap, and that's the correct outcome.

Your final message is only this JSON, with no other text:
{"claims":[{"requirement":"1","file":"repo/relative/path","line":123,"quote":"one exact line copied from that file","why":"one sentence: how this line meets the requirement"}]}
