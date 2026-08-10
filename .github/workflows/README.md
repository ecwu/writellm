# GitHub Actions disabled

All WriteLLM GitHub Actions workflows are intentionally disabled to prevent any runner usage.
Their preserved definitions use the `.yml.disabled` suffix, which GitHub does not recognize as a
workflow file.

Restoring CI requires explicit user approval and both of these actions:

1. Rename the required definition back to a `.yml` file under this directory.
2. Explicitly enable that workflow in the GitHub repository.

Do not restore event triggers or enable a workflow merely as part of unrelated maintenance.
