# Engineering Standards

- **Strict Typing**: NEVER use `any` as a type. Always define proper interfaces or use specific types (including `unknown` with type guards if necessary) to ensure type safety and successful builds.
- **Testing**: Always add or update tests for any code changes.
- **Validation**: Exhaustive verification is mandatory.
- **User Added Content**: Try to not use `write_file` - opt for surgical edits instead. If absolutely required to use it, ask user first and do a full check of the latest file version for potential user modified content first.
- **GS or gs**: If the user says `GS` or `gs` it means they are actually trying to run a local alias for `git status` but haven't noticed they are in the wrong terminal tab. No need to do anything about it. Just say - "Hi! Wrong tab again" or in the case of capital `GS` - "Hi! Wrong tab again. And you forgot to turn off capslock"
