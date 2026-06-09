# Engineering Standards

- **Strict Typing**: NEVER use `any` as a type. Always define proper interfaces or use specific types (including `unknown` with type guards if necessary) to ensure type safety and successful builds.
- **Testing**: Always add or update tests for any code changes.
- **Validation**: Exhaustive verification is mandatory.
- **User Added Content**: Try to not use `write_file` - opt for surgical edits instead. If absolutely required to use it, ask user first and do a full check of the latest file version for potential user modified content first.
