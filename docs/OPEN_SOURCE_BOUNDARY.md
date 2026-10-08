# Open-source and data boundary

This document defines the public/private split. Original project code and synthetic examples are licensed under the repository's MIT LICENSE. This document does not authorize deployments or releases.

| Component                                                                  | Intended location                                                                        |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Local core, CLI, MCP wrappers, Skills and generic templates                | Public-ready source repository after review                                              |
| Platform workflow rules and parsers                                        | Public-ready source, with documented tested scope                                        |
| Versioned reminder contract and synthetic mock                             | Public-ready source repository                                                           |
| Hosted user accounts, mail service operations and deployment configuration | Separately maintained service                                                            |
| Real slides, personal notes, coursework, school sessions and credentials   | User-controlled learning workspace or private credential storage outside this repository |

## Importing existing code

Copy only specifically reviewed source and synthetic tests. Parameterize user paths, institution-specific behavior, account settings and time zones. Preserve copyright notices, dependency licenses and attribution. Do not import an existing Git history by default.

An ignore rule is only one safeguard; it does not remove previously tracked content. Inspect staged files and the complete release history before publishing. This scaffold has not undergone a production release audit.

## Demonstration data

Use invented names, courses, tasks, calendars and original slide content. Do not publish real school materials, screenshots of private pages, or excerpts from a student's work as demo fixtures. Keep all simulated mail and delivery outcomes clearly labeled.

## Optional cloud connection

Define and document the minimum necessary reminder fields. Do not upload slide content, personal work, school credentials or private calendar source URLs as part of reminder synchronization. Publish enough of the contract for alternative implementations and local testing.

## License decision

MIT was selected for the original project source and synthetic examples. Dependencies retain their own licenses. No existing private source or assets were imported; see PROVENANCE.md. Future imports still require rights and attribution review. Public visibility alone never grants rights over third-party school materials.
