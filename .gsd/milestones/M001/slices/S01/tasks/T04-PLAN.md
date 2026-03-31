---
estimated_steps: 1
estimated_files: 2
skills_used: []
---

# T04: Write PROJECT.md and verify local Supabase stack

1. Create .gsd/PROJECT.md describing the OACP project\n2. Create top-level README.md with project overview and setup instructions\n3. Verify supabase start brings up the stack (if Docker available)\n4. Verify migration applies cleanly\n5. Test health endpoint if local stack is running\n6. Commit all work

## Inputs

- None specified.

## Expected Output

- `.gsd/PROJECT.md`
- `README.md`

## Verification

cat .gsd/PROJECT.md && cat README.md | head -20
