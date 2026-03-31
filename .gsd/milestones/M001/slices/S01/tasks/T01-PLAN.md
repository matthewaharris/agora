---
estimated_steps: 1
estimated_files: 5
skills_used: []
---

# T01: Initialize Supabase project and monorepo structure

1. Run supabase init to create supabase/ directory\n2. Create top-level package.json for monorepo\n3. Create directory structure: packages/oacp-sdk/, apps/dashboard/, agents/\n4. Create .gitignore with node_modules, .env, supabase/.temp/\n5. Add supabase/config.toml with project name

## Inputs

- `PRD/OACP_PRD_v0.1.docx`

## Expected Output

- `supabase/config.toml`
- `package.json`
- `.gitignore`

## Verification

ls supabase/config.toml && cat package.json | grep name
