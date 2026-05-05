var SystematicReviewerResponsesToolCatalog = (() => {
	const TOP_LEVEL_IDS = new Set([
		"sr.getProjectContext",
		"sr.projectList",
		"sr.projectOpen",
		"sr.projectBind",
		"sr.scopeList",
		"sr.sessionList",
		"sr.sessionOpen",
		"sr.sessionStatus",
	]);

	const NAMESPACE_DESCRIPTIONS = Object.freeze({
		manual: "Workflow manuals, stage guidance, decision rules, and reporting instructions for systematic-review and custom-analysis projects.",
		harvest: "Search strategy, OpenAlex estimates and imports, saved harvest runs, source merges, and output inspection.",
		extraction: "Extraction templates, extraction sources, single-item and batch extraction runs, and extracted field updates.",
		embeddings: "Embeddings source management, stored embeddings inspection, embeddings runs, and semantic evidence search.",
		semantic: "Semantic search, hit opening, and semantic previews for scoped project evidence.",
		documents: "Find Arguments retrieval over project full-text chunks, with keyword or semantic modes, pagination, and markdown-viewer hit opening.",
		project_data: "Safe paged inspection of canonical project row data, scopes, columns, and one-row lookups without raw SQLite access.",
		items: "Explicit-target Zotero item creation and identifier imports that mutate the current project collections.",
		mcp: "Lazy broker access to user-configured external MCP servers, including their advertised tools, resources, and prompts.",
		screening: "Screening list/search/update flows, saved runs, filters, columns, comments, rules, and bulk review actions.",
		descriptives: "Scoped descriptive statistics over screening-accessible columns, including counts, percents, numeric summaries, optional item-key/citation-token details, and saved descriptives runs.",
		full_text: "Full-text retrieval watches, markdown conversion queues, unretrieved-report finalization, and inclusion-stage completion helpers.",
		prisma: "PRISMA state, automatic counts, render/export operations, and related review accounting.",
		explore: "Explore tables, chat sessions, CSV export, query runs, snapshots, and scoped citation helpers.",
		jobs: "Background job listing, job inspection, and recent runtime job state for the current project.",
		project_admin: "Project lifecycle, project bindings, collection/project management, and session/project navigation helpers.",
		ui: "Open or move Zotero tabs, item actions, and UI-level helpers that act on the real plugin surfaces.",
		workspace: "Project report/log editing helpers and file operations that modify or inspect the real project workspace.",
		shell: "Privileged local shell execution for the in-app session agent only.",
		browser: "Privileged webpage browsing, page interaction, live page reading, screenshots, and project-aware webpage saving.",
		automation_document: "Automation workspace document rendering, save/export flows, and report asset helpers.",
	});

	const NAMESPACE_ORDER = [
		"workspace",
		"shell",
		"browser",
		"project_admin",
		"manual",
		"harvest",
		"screening",
		"descriptives",
		"embeddings",
		"semantic",
		"documents",
		"project_data",
		"items",
		"mcp",
		"full_text",
		"extraction",
		"explore",
		"prisma",
		"jobs",
		"automation_document",
		"ui",
	];
	const TOOL_DESCRIPTION_OVERRIDES = Object.freeze({
	  "get_project_context": {
	    "description": "Return the active stored-project context and resolved root paths so later calls can reuse the real project workspace instead of guessing paths.",
	    "example_call": {
	      "tool": "get_project_context",
	      "args": {
	        "root": "current_project"
	      }
	    }
	  },
	  "project_bind": {
	    "description": "Bind a real stored project and session so later tool calls can follow the actual project context, report path, database path, and active session instead of inventing IDs.",
	    "example_call": {
	      "tool": "project_bind",
	      "args": {
	        "project_id": "<PROJECT_ID>",
	        "session_id": "<SESSION_ID>"
	      }
	    }
	  },
	  "project_list": {
	    "description": "List the stored projects currently known to the plugin so later calls can pick a real project ID instead of guessing one.",
	    "example_call": {
	      "tool": "project_list",
	      "args": {}
	    }
	  },
	  "project_open": {
	    "description": "Open an existing stored project by ID and make its session state current for follow-up work.",
	    "example_call": {
	      "tool": "project_open",
	      "args": {
	        "project_id": "<PROJECT_ID>"
	      }
	    }
	  },
	  "scope_list": {
	    "description": "Return the currently valid screening/review scopes for the bound project so later scoped calls can use real collection keys and labels.",
	    "example_call": {
	      "tool": "scope_list",
	      "args": {
	        "root": "current_project"
	      }
	    }
	  },
	  "session_list": {
	    "description": "List the stored sessions for a project so later calls can choose a real session ID instead of inventing one.",
	    "example_call": {
	      "tool": "session_list",
	      "args": {
	        "root": "current_project"
	      }
	    }
	  },
	  "session_open": {
	    "description": "Open an existing session or create a new one for the current project, then make it the active session for follow-up calls.",
	    "example_call": {
	      "tool": "session_open",
	      "args": {
	        "root": "current_project",
	        "newSession": true,
	        "title": "Validation Manual Session"
	      }
	    }
	  },
	  "session_status": {
	    "description": "Return the current state of one project session, including session metadata, transcript context, and timeline activity.",
	    "example_call": {
	      "tool": "session_status",
	      "args": {
	        "root": "current_project",
	        "session_id": "<SESSION_ID>"
	      }
	    }
	  },
	  "shell__run": {
	    "description": "Run one local shell command for the in-app session agent using the configured privileged shell runtime.",
	    "example_call": {
	      "tool": "shell__run",
	      "args": {
	        "command": "python -m venv .venv",
	        "cwd": "<PROJECT_ROOT>",
	        "timeout_ms": 600000
	      }
	    }
	  },
	  "browser__open": {
	    "description": "Open a URL in the privileged browser and optionally reuse or create a browser window for follow-up browsing steps.",
	    "example_call": {
	      "tool": "browser__open",
	      "args": {
	        "url": "https://www.zotero.org/support/"
	      }
	    }
	  },
	  "browser__read_page": {
	    "description": "Read the current live webpage as cleaned markdown for documentation lookup, research, or transient browsing without creating Zotero items. Large reads automatically save the full markdown into the active session folder and return its path.",
	    "example_call": {
	      "tool": "browser__read_page",
	      "args": {
	        "selector": "main",
	        "max_chars": 20000
	      }
	    }
	  },
	  "browser__expand_page": {
	    "description": "Reveal bounded hidden content on the current page by clicking low-risk read-more, show-more, or details controls without navigating away.",
	    "example_call": {
	      "tool": "browser__expand_page",
	      "args": {
	        "max_rounds": 3
	      }
	    }
	  },
	  "browser__load_more": {
	    "description": "Boundedly continue comments, lists, or feed-like content by clicking load-more style controls or scrolling, with hard stop conditions.",
	    "example_call": {
	      "tool": "browser__load_more",
	      "args": {
	        "max_rounds": 5,
	        "max_scrolls": 6
	      }
	    }
	  },
	  "browser__save_page_to_project": {
	    "description": "Save the current webpage into the active project as a Zotero webpage item with a snapshot and PDF, using the project's default or explicitly selected target collection.",
	    "example_call": {
	      "tool": "browser__save_page_to_project",
	      "args": {
	        "project_id": "<PROJECT_ID>"
	      }
	    }
	  },
	  "browser__actions": {
	    "description": "List visible interactive elements on the current page so later browser interaction calls can target real action ids instead of guessing selectors.",
	    "example_call": {
	      "tool": "browser__actions",
	      "args": {
	        "max_nodes": 60
	      }
	    }
	  },
	  "browser__screenshot": {
	    "description": "Capture a screenshot of the current browser page, including full-page stitched captures when needed.",
	    "example_call": {
	      "tool": "browser__screenshot",
	      "args": {
	        "mode": "fullpage_stitched"
	      }
	    }
	  },
	  "project_admin__project_reveal_folder": {
	    "description": "Open the real stored project folder in the OS file browser so the user can inspect the actual on-disk project workspace.",
	    "example_call": {
	      "tool": "project_admin__project_reveal_folder",
	      "args": {
	        "project_id": "<PROJECT_ID>"
	      }
	    }
	  },
	  "project_admin__session_message": {
	    "description": "Push one message into the shared project session router so the message is recorded against a real session instead of being simulated in client memory.",
	    "example_call": {
	      "tool": "project_admin__session_message",
	      "args": {
	        "root": "current_project",
	        "session_id": "<SESSION_ID>",
	        "message": "Validation manual router ping."
	      }
	    }
	  },
	  "project_admin__session_next": {
	    "description": "Create or activate a session, and optionally send a message, in one router-level call when session navigation and message injection need to happen together.",
	    "example_call": {
	      "tool": "project_admin__session_next",
	      "args": {
	        "root": "current_project",
	        "newSession": true,
	        "title": "Validation Session Next Manual"
	      }
	    }
	  },
	  "project_admin__project_delete": {
	    "description": "Delete one stored project root and its Systematic Reviewer project item, with optional deletion of the backing Zotero collection.",
	    "example_call": {
	      "tool": "project_admin__project_delete",
	      "args": {
	        "project_id": "PROJECT_ID",
	        "delete_collection": false
	      }
	    }
	  },
	  "manual__read": {
	    "description": "Read the bundled workflow manual content for a stage, action, or workflow question so the caller can ground decisions in the shipped guidance instead of improvising process rules.",
	    "example_call": {
	      "tool": "manual__read",
	      "args": {
	        "workflow": "systematic_review_full",
	        "stage": "harvest",
	        "question": "What should happen before running a harvest?"
	      }
	    }
	  },
	  "automation_document__bootstrap": {
	    "description": "Load the current Automation document workspace state so later document operations work against the real project/session context.",
	    "example_call": {
	      "tool": "automation_document__bootstrap",
	      "args": {}
	    }
	  },
	  "automation_document__document_editor_settings_save": {
	    "description": "Persist Automation document editor preferences such as page-number visibility or style settings for the active project/session.",
	    "example_call": {
	      "tool": "automation_document__document_editor_settings_save",
	      "args": {
	        "settings": {
	          "show_page_numbers": true
	        }
	      }
	    }
	  },
	  "automation_document__document_export_pdf": {
	    "description": "Export the current Automation document as PDF using the active project document state.",
	    "example_call": {
	      "tool": "automation_document__document_export_pdf",
	      "args": {}
	    }
	  },
	  "automation_document__document_export_plain_markdown": {
	    "description": "Export the current Automation document as plain markdown for external inspection or reuse.",
	    "example_call": {
	      "tool": "automation_document__document_export_plain_markdown",
	      "args": {}
	    }
	  },
	  "automation_document__document_import_image": {
	    "description": "Copy an external image into the Automation document assets area for the active project so later document content can reference a real stored asset.",
	    "example_call": {
	      "tool": "automation_document__document_import_image",
	      "args": {
	        "path": "<ABSOLUTE_IMAGE_PATH>",
	        "name": "validation-teal.png"
	      }
	    }
	  },
	  "automation_document__document_render": {
	    "description": "Render the Automation document view, optionally with a markdown override, without persisting those changes to the report file.",
	    "example_call": {
	      "tool": "automation_document__document_render",
	      "args": {
	        "surface": "preview",
	        "markdown": "# Validation Render\n\nPreview-only render test."
	      }
	    }
	  },
	  "automation_document__document_save": {
	    "description": "Persist Automation document markdown into the project report file, optionally with a save-reason tag.",
	    "example_call": {
	      "tool": "automation_document__document_save",
	      "args": {
	        "markdown": "# Validation Save\n\nSaved by automation_document__document_save during manual tool validation.\n",
	        "save_reason": "manual-save"
	      }
	    }
	  },
	  "workspace__apply_patch": {
	    "description": "Apply a structured multi-file patch under the selected root when the caller already has an opencode-style patch block and wants the tool to write it directly.",
	    "example_call": {
	      "tool": "workspace__apply_patch",
	      "args": {
	        "root": "storage_root",
	        "patch": "*** Begin Patch\n*** Update File: tool-catalog-fixtures/sample.md\n@@\n Seed content for manual workspace-tool validation.\n+Patched by workspace__apply_patch.\n*** End Patch\n"
	      }
	    }
	  },
	  "workspace__list_dir": {
	    "description": "List the real files under a selected root-relative directory so later file calls can reuse existing names instead of inventing them.",
	    "example_call": {
	      "tool": "workspace__list_dir",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures"
	      }
	    }
	  },
	  "workspace__patch_file": {
	    "description": "Modify a text file with structured string or line-based operations when a full patch block is unnecessary.",
	    "example_call": {
	      "tool": "workspace__patch_file",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures/sample.md",
	        "operations": [
	          {
	            "type": "append",
	            "content": "\nPatched by workspace__patch_file.\n"
	          }
	        ]
	      }
	    }
	  },
	  "workspace__patch_markdown": {
	    "description": "Modify markdown-like files by targeting a real heading or exact headingPath so report and log edits stay structurally anchored instead of relying on raw string replacement. Use this after listing headings or reading the target section when you want a section-scoped update.",
	    "example_text": "Recommended flow: workspace__read_markdown_headings({\"root\":\"current_project\",\"path\":\"REPORT.md\"}) then workspace__read_markdown_section({\"root\":\"current_project\",\"path\":\"REPORT.md\",\"headingPath\":[\"Methods\"]}) then workspace__patch_markdown({...}).",
	    "example_call": {
	      "tool": "workspace__patch_markdown",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures/sample.md",
	        "operations": [
	          {
	            "type": "append_section",
	            "headingPath": [
	              "Validation Fixture"
	            ],
	            "content": "Appended inside the existing Validation Fixture section by workspace__patch_markdown."
	          }
	        ]
	      }
	    }
	  },
	  "workspace__read_file": {
	    "description": "Read a text file from the selected root, optionally with line slicing, so later edits can target the real file contents instead of assumptions.",
	    "example_call": {
	      "tool": "workspace__read_file",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures/sample.md",
	        "include_line_numbers": true
	      }
	    }
	  },
	  "workspace__search_file": {
	    "description": "Search one project text or markdown file for a literal string or regex and return capped line-numbered snippets. Use this to find REPORT.md markers, Appendix headings, PRISMA/bibliography placeholders, or log phrases without reading the whole file into context.",
	    "example_text": "Marker check example: workspace__search_file({\"root\":\"current_project\",\"path\":\"REPORT.md\",\"query\":\"<!-- sr:toc -->\"}). Regex section check: workspace__search_file({\"root\":\"current_project\",\"path\":\"REPORT.md\",\"query\":\"^#+\\\\s+Appendix|^#+\\\\s+Appendices\",\"regex\":true}).",
	    "example_call": {
	      "tool": "workspace__search_file",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures/sample.md",
	        "query": "Validation Fixture",
	        "max_results": 10
	      }
	    }
	  },
	  "workspace__read_json": {
	    "description": "Read and parse a JSON file under the selected root so downstream calls can inspect structured file state directly.",
	    "example_call": {
	      "tool": "workspace__read_json",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures/state.json"
	      }
	    }
	  },
	  "workspace__read_markdown_headings": {
	    "description": "List markdown headings from one markdown-like file, including log.txt, so the caller can discover the real section structure cheaply before reading or patching a specific section body.",
	    "example_text": "Use this first for token-light discovery, then call workspace__read_markdown_section or workspace__patch_markdown with the returned headingPath values.",
	    "example_call": {
	      "tool": "workspace__read_markdown_headings",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures/sample.md",
	        "max_depth": 3
	      }
	    }
	  },
	  "workspace__read_markdown_section": {
	    "description": "Read a specific markdown section by heading text, exact headingPath, or a heading-to-heading range when the caller needs one real section body from REPORT.md or log.txt instead of the whole file.",
	    "example_text": "Exact path example: workspace__read_markdown_section({\"root\":\"current_project\",\"path\":\"log.txt\",\"headingPath\":[\"Harvest\"]}). Range example: workspace__read_markdown_section({\"root\":\"current_project\",\"path\":\"REPORT.md\",\"headingPath\":[\"Methods\"],\"to_heading\":\"Results\"}).",
	    "example_call": {
	      "tool": "workspace__read_markdown_section",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures/sample.md",
	        "headingPath": [
	          "Validation Fixture"
	        ],
	        "include_heading": true
	      }
	    }
	  },
	  "workspace__read_yaml": {
	    "description": "Read a YAML file from the selected root and return its stored text/metadata so the caller can inspect the actual YAML payload.",
	    "example_call": {
	      "tool": "workspace__read_yaml",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures/state.yaml"
	      }
	    }
	  },
	  "workspace__runtime_inventory_scan": {
	    "description": "Refresh the runtime inventory so the caller can see what API connections, models, and local executors are actually available right now.",
	    "example_call": {
	      "tool": "workspace__runtime_inventory_scan",
	      "args": {}
	    }
	  },
	  "workspace__runtime_role_test": {
	    "description": "Validate one configured runtime role against the live runtime settings so failures show up before a workflow depends on that role.",
	    "example_call": {
	      "tool": "workspace__runtime_role_test",
	      "args": {
	        "role_id": "session_chat"
	      }
	    }
	  },
	  "workspace__runtime_settings_get": {
	    "description": "Return the current runtime settings, configured API connections, and detected executors so later runtime changes can be based on the real current state.",
	    "example_call": {
	      "tool": "workspace__runtime_settings_get",
	      "args": {}
	    }
	  },
	  "workspace__runtime_settings_save": {
	    "description": "Persist runtime configuration changes such as API connections, role assignments, or PDF-markdown settings.",
	    "example_call": {
	      "tool": "workspace__runtime_settings_save",
	      "args": {
	        "pdf_markdown": {
	          "mode": "fast"
	        }
	      }
	    }
	  },
	  "workspace__write_file": {
	    "description": "Write plain text to a root-relative file path, creating or overwriting the file with the provided content.",
	    "example_call": {
	      "tool": "workspace__write_file",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures/sample.md",
	        "content": "# Validation Fixture\n\nSeed content for manual workspace-tool validation.\n"
	      }
	    }
	  },
	  "workspace__write_json": {
	    "description": "Write structured JSON data to a root-relative file path.",
	    "example_call": {
	      "tool": "workspace__write_json",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures/state.json",
	        "value": {
	          "ok": true,
	          "label": "validation"
	        }
	      }
	    }
	  },
	  "workspace__write_yaml": {
	    "description": "Write raw YAML text to a root-relative file path.",
	    "example_call": {
	      "tool": "workspace__write_yaml",
	      "args": {
	        "root": "storage_root",
	        "path": "tool-catalog-fixtures/state.yaml",
	        "content": "ok: true\nlabel: validation\n"
	      }
	    }
	  },
	  "harvest__config_get": {
	    "description": "Load the active project's Harvest configuration, including query controls, OpenAlex filter metadata, and the saved API credit state.",
	    "example_call": {
	      "tool": "harvest__config_get",
	      "args": {}
	    }
	  },
	  "harvest__merge_all_sources": {
	    "description": "Merge all Harvest source subcollections into Pending in one pass, deduplicate known overlaps, and refresh embeddings when that project option is enabled.",
	    "example_call": {
	      "tool": "harvest__merge_all_sources",
	      "args": {}
	    }
	  },
	  "harvest__merge_source": {
	    "description": "Merge one specific Harvest source subcollection into Pending, deduplicate known overlaps, and refresh embeddings when that project option is enabled.",
	    "example_call": {
	      "tool": "harvest__merge_source",
	      "args": {
	        "source_collection_key": "SOURCE_COLLECTION_KEY"
	      }
	    }
	  },
	  "harvest__open_alex": {
	    "description": "Run an OpenAlex search or import into the active project, using query text and optional search controls such as field, date range, result count, and attachment behavior.",
	    "example_call": {
	      "tool": "harvest__open_alex",
	      "args": {
	        "query": "validation",
	        "field": "title",
	        "maxResults": 1,
	        "searchMode": "estimate",
	        "attachment_fetch_mode": "none"
	      }
	    }
	  },
	  "harvest__output_read": {
	    "description": "Load one saved Harvest summary artifact by path or file name so its recorded query and result metadata can be inspected.",
	    "example_call": {
	      "tool": "harvest__output_read",
	      "args": {
	        "path": "/absolute/path/to/harvest-summary.json"
	      }
	    }
	  },
	  "harvest__outputs_list": {
	    "description": "List saved Harvest summary artifacts for the active project so a specific report can be opened or reviewed.",
	    "example_call": {
	      "tool": "harvest__outputs_list",
	      "args": {}
	    }
	  },
	  "harvest__rate_limit_get": {
	    "description": "Refresh and return the saved OpenAlex API credit state for the active project.",
	    "example_call": {
	      "tool": "harvest__rate_limit_get",
	      "args": {}
	    }
	  },
	  "harvest__runs_list": {
	    "description": "List recent Harvest and Harvest-estimate jobs saved for the active project.",
	    "example_call": {
	      "tool": "harvest__runs_list",
	      "args": {
	        "limit": 10
	      }
	    }
	  },
	  "harvest__sources_list": {
	    "description": "List the Harvest source subcollections alongside the standard workflow collections for the active project.",
	    "example_call": {
	      "tool": "harvest__sources_list",
	      "args": {}
	    }
	  },
	  "jobs__delete": {
	    "description": "Remove one saved plugin job record, along with any stored logs, from the current project history.",
	    "example_call": {
	      "tool": "jobs__delete",
	      "args": {
	        "job_id": "JOB_ID"
	      }
	    }
	  },
	  "jobs__list": {
	    "description": "List recent plugin jobs saved for the active project.",
	    "example_call": {
	      "tool": "jobs__list",
	      "args": {
	        "limit": 10
	      }
	    }
	  },
	  "jobs__load": {
	    "description": "Load one saved plugin job and return its details and recent log lines.",
	    "example_call": {
	      "tool": "jobs__load",
	      "args": {
	        "job_id": "JOB_ID",
	        "log_limit": 20
	      }
	    }
	  },
	  "embeddings__refresh": {
	    "description": "Refresh the embeddings status for the active project or a selected subcollection and return the available scopes, text sources, and stored vector state.",
	    "example_call": {
	      "tool": "embeddings__refresh",
	      "args": {}
	    }
	  },
	  "embeddings__run": {
	    "description": "Generate embeddings for one text source in the active project or selected subcollection and store them in the project's SQLite vector store.",
	    "example_call": {
	      "tool": "embeddings__run",
	      "args": {
	        "source_key": "title",
	        "scope": "pending",
	        "resume": true
	      }
	    }
	  },
	  "embeddings__sources_list": {
	    "description": "List the text sources that can be embedded for the active project or a selected subcollection.",
	    "example_call": {
	      "tool": "embeddings__sources_list",
	      "args": {}
	    }
	  },
	  "embeddings__stored_list": {
	    "description": "List the embedding sets currently stored for the project, including source, model, and vector counts.",
	    "example_call": {
	      "tool": "embeddings__stored_list",
	      "args": {}
	    }
	  },
	  "semantic__config_get": {
	    "description": "Load the semantic-search configuration for the active project, including valid scopes, compatible stored embedding sources, and existing semantic score columns.",
	    "example_call": {
	      "tool": "semantic__config_get",
	      "args": {}
	    }
	  },
	  "semantic__hit_open": {
	    "description": "Open the saved semantic full-text hit for one item and score column in the markdown viewer, including the attachment and highlighted text passage.",
	    "example_call": {
	      "tool": "semantic__hit_open",
	      "args": {
	        "item_key": "ITEM_KEY",
	        "column_key": "SEMANTIC_COLUMN_KEY"
	      }
	    }
	  },
	  "semantic__inspect_scores": {
	    "description": "Inspect one semantic score column by score band and return counts plus sampled matching records from the active scope.",
	    "example_call": {
	      "tool": "semantic__inspect_scores",
	      "args": {
	        "score_column": "SEMANTIC_COLUMN_KEY",
	        "sample_limit": 2
	      }
	    }
	  },
	  "semantic__preview_item": {
	    "description": "Load one semantic result item with its full abstract and any saved extraction values for inspection.",
	    "example_call": {
	      "tool": "semantic__preview_item",
	      "args": {
	        "item_key": "ITEM_KEY"
	      }
	    }
	  },
	  "semantic__score_columns_list": {
	    "description": "List the semantic score columns already written into Screening for the active project.",
	    "example_call": {
	      "tool": "semantic__score_columns_list",
	      "args": {}
	    }
	  },
	  "semantic__search": {
	    "description": "Run semantic search over the active project using stored embeddings, write a score column, and return ranked matching records.",
	    "example_call": {
	      "tool": "semantic__search",
	      "args": {
	        "query": "validation",
	        "source_key": "title",
	        "scope": "pending",
	        "limit": 4
	      }
	    }
	  },
	  "documents__config_get": {
	    "description": "Load Find Arguments status for the active project, including the native keyword backend and whether full-text semantic vectors are available.",
	    "example_call": {
	      "tool": "documents__config_get",
	      "args": {
	        "scope": "included"
	      }
	    }
	  },
	  "documents__find": {
	    "description": "Run Find Arguments to find the best matching project documents and chunks for a query. Use keyword when embeddings are unavailable or exact language matters; use semantic when full-text vectors exist and conceptual similarity matters. Returns concise markdown, grouped results, and a search_id for follow-up.",
	    "example_call": {
	      "tool": "documents__find",
	      "args": {
	        "mode": "keyword",
	        "query": "patient reported depression symptoms",
	        "scope": "included",
	        "limit": 5,
	        "chunks_per_document": 2
	      }
	    }
	  },
	  "documents__find_next": {
	    "description": "Load the next page of globally ranked documents for an earlier Find Arguments search_id without rerunning the search.",
	    "example_call": {
	      "tool": "documents__find_next",
	      "args": {
	        "search_id": "find-SEARCH_ID"
	      }
	    }
	  },
	  "documents__hit_open": {
	    "description": "Open one Find Arguments hit in the markdown/PDF viewer with the matching text highlighted. Prefer passing search_id plus item_key and chunk_index from documents__find results.",
	    "example_call": {
	      "tool": "documents__hit_open",
	      "args": {
	        "search_id": "find-SEARCH_ID",
	        "item_key": "ITEM_KEY",
	        "chunk_index": 3
	      }
	    }
	  },
	  "project_data__schema": {
	    "description": "List safe project-data inspection metadata: available scopes, row count, columns, column origins, and warnings. Call this first before reading rows so you can choose scope and columns.",
	    "example_call": {
	      "tool": "project_data__schema",
	      "args": {
	        "scope": "included"
	      }
	    }
	  },
	  "project_data__rows": {
	    "description": "Read one paged row window from the canonical project data table. The limit is capped at 25 to protect context. Always choose explicit columns and page with offset. For synthesis over many rows, use Explore instead.",
	    "example_call": {
	      "tool": "project_data__rows",
	      "args": {
	        "scope": "included",
	        "columns": ["title", "year", "decision"],
	        "limit": 25,
	        "offset": 0
	      }
	    }
	  },
	  "project_data__row": {
	    "description": "Inspect one project row by item_key, optionally with explicit columns. Use this when you already know which citation/item needs detail.",
	    "example_call": {
	      "tool": "project_data__row",
	      "args": {
	        "item_key": "ITEMKEY",
	        "columns": ["title", "abstract_note", "decision"]
	      }
	    }
	  },
	  "items__create": {
	    "description": "Create one manual Zotero item in an explicit in-project target. This mutates Zotero/project collections and does not deduplicate. Provide collection_key, collection_name, scope, or harvest_source_name.",
	    "example_call": {
	      "tool": "items__create",
	      "args": {
	        "harvest_source_name": "Manual additions",
	        "item_type": "report",
	        "title": "Example policy report",
	        "creators": [{"creatorType": "author", "name": "Example Organization"}],
	        "year": "2024",
	        "url": "https://example.org/report"
	      }
	    }
	  },
	  "items__create_many": {
	    "description": "Create up to 50 manual Zotero items in one explicit in-project target. This mutates Zotero/project collections and creates new items without upsert/dedupe.",
	    "example_call": {
	      "tool": "items__create_many",
	      "args": {
	        "collection_name": "Data",
	        "items": [
	          {
	            "item_type": "webpage",
	            "title": "Example dataset page",
	            "url": "https://example.org/data"
	          }
	        ]
	      }
	    }
	  },
	  "items__read_metadata": {
	    "description": "Read one existing Zotero item by item key as native Zotero item JSON. Use only when allowed and asked by the user to inspect item metadata, or when you are working on imports of custom data into projects yourself and want better metadata support. Use this before writing metadata so you see the real item type, current fields, creators, tags, collections, and supported native field names.",
	    "example_call": {
	      "tool": "items__read_metadata",
	      "args": {
	        "item_key": "ITEMKEY"
	      }
	    }
	  },
	  "items__write_metadata": {
	    "description": "Write native Zotero metadata fields on one existing Zotero item by item key. Use only when allowed and asked by the user to edit metadata of items, or when you are working on imports of custom data into projects yourself and want better metadata support. The item key is immutable and cannot be changed. Use fields or metadata with Zotero native field names, plus creators when needed.",
	    "example_call": {
	      "tool": "items__write_metadata",
	      "args": {
	        "item_key": "ITEMKEY",
	        "fields": {
	          "title": "Example article title",
	          "date": "2026",
	          "DOI": "10.1000/example"
	        },
	        "creators": [
	          {"creatorType": "author", "firstName": "Aurelia", "lastName": "Veridiana"}
	        ]
	      }
	    }
	  },
	  "items__write_metadata_many": {
	    "description": "Write native Zotero metadata fields on up to 50 existing Zotero items by item key. Use only when allowed and asked by the user to edit metadata of items, or when you are working on imports of custom data into projects yourself and want better metadata support. Item keys are immutable and cannot be changed.",
	    "example_call": {
	      "tool": "items__write_metadata_many",
	      "args": {
	        "items": [
	          {
	            "item_key": "ITEMKEY",
	            "fields": {"date": "2026"}
	          }
	        ]
	      }
	    }
	  },
	  "items__update_metadata": {
	    "description": "Alias for items__write_metadata. Write native Zotero metadata fields on one existing Zotero item by item key. Use only when allowed and asked by the user to edit metadata of items, or when you are working on imports of custom data into projects yourself and want better metadata support. Item keys are immutable and cannot be changed.",
	    "example_call": {
	      "tool": "items__update_metadata",
	      "args": {
	        "item_key": "ITEMKEY",
	        "fields": {
	          "date": "2026",
	          "DOI": "10.1000/example"
	        }
	      }
	    }
	  },
	  "items__update_metadata_many": {
	    "description": "Alias for items__write_metadata_many. Write native Zotero metadata fields on up to 50 existing Zotero items by item key. Use only when allowed and asked by the user to edit metadata of items, or when you are working on imports of custom data into projects yourself and want better metadata support. Item keys are immutable and cannot be changed.",
	    "example_call": {
	      "tool": "items__update_metadata_many",
	      "args": {
	        "items": [
	          {
	            "item_key": "ITEMKEY",
	            "fields": {"date": "2026"}
	          }
	        ]
	      }
	    }
	  },
	  "items__import_identifiers": {
	    "description": "Import DOI, PMID, PMCID, arXiv, or ISBN identifiers through Zotero translators into an explicit in-project target. PMCID is resolved to PMID when possible. Optional Harvest post-import actions can queue merge into Pending.",
	    "example_call": {
	      "tool": "items__import_identifiers",
	      "args": {
	        "harvest_source_name": "Identifier imports",
	        "identifiers": [
	          {"type": "DOI", "value": "10.1000/example"}
	        ],
	        "post_import_action": "none"
	      }
	    }
	  },
	  "prisma__compute": {
	    "description": "Compute the current PRISMA counts for the active project and append a timestamped PRISMA Compute artifact to `log.txt`. Successful compute runs should then refresh the canonical `REPORT.md` PRISMA section from those grounded counts.",
	    "example_call": {
	      "tool": "prisma__compute",
	      "args": {}
	    }
	  },
	  "prisma__export": {
	    "description": "Export the current PRISMA state and markdown summary into the project's PRISMA outputs folder.",
	    "example_call": {
	      "tool": "prisma__export",
	      "args": {}
	    }
	  },
	  "prisma__get_state": {
	    "description": "Load the saved PRISMA configuration merged with the current automatically computed review counts.",
	    "example_call": {
	      "tool": "prisma__get_state",
	      "args": {}
	    }
	  },
	  "prisma__render": {
	    "description": "Render the current PRISMA diagram with optional transient display overrides such as font size, labels, hidden nodes, or corner radius.",
	    "example_call": {
	      "tool": "prisma__render",
	      "args": {
	        "fontSize": "15",
	        "cornerRadius": "6"
	      }
	    }
	  },
	  "prisma__save_state": {
	    "description": "Persist PRISMA labels, hidden nodes, options, and manual overrides for the active project.",
	    "example_call": {
	      "tool": "prisma__save_state",
	      "args": {
	        "labels": {
	          "records_screened": "Records screened (validated)"
	        }
	      }
	    }
	  },
	  "full_text__complete_inclusion": {
	    "description": "After retrieved full-text eligibility failures have been moved to Excluded FT, move the remaining full-text-ready Pending items into Included and switch downstream extraction/Explore scope to Included.",
	    "example_call": {
	      "tool": "full_text__complete_inclusion",
	      "args": {
	        "scope": "pending",
	        "reason": "Validation inclusion pass",
	        "notes": "Manual validation run"
	      }
	    }
	  },
	  "full_text__conversion_status": {
	    "description": "List markdown conversion jobs for the current full-text scope, including status, mode, and output attachment details.",
	    "example_call": {
	      "tool": "full_text__conversion_status",
	      "args": {
	        "scope": "pending"
	      }
	    }
	  },
	  "full_text__finalize_unretrieved": {
	    "description": "Move Pending records that still lack retrieved full text into Excluded with the stable full_text_not_retrieved reason; these are not full-text exclusions.",
	    "example_call": {
	      "tool": "full_text__finalize_unretrieved",
	      "args": {
	        "scope": "pending",
	        "notes": "Validation finalize unretrieved pass"
	      }
	    }
	  },
	  "full_text__list_items": {
	    "description": "List the retrieved and unretrieved full-text records for the active scope.",
	    "example_call": {
	      "tool": "full_text__list_items",
	      "args": {
	        "scope": "pending"
	      }
	    }
	  },
	  "full_text__queue_conversions": {
	    "description": "Queue markdown conversions for retrieved PDFs in the selected full-text scope using the configured PDF conversion mode.",
	    "example_call": {
	      "tool": "full_text__queue_conversions",
	      "args": {
	        "scope": "pending"
	      }
	    }
	  },
	  "full_text__start_retrieval": {
	    "description": "Start the Zotero full-text or PDF retrieval watch for the selected Pending scope and record the retrieval-watch job state.",
	    "example_call": {
	      "tool": "full_text__start_retrieval",
	      "args": {
	        "scope": "pending"
	      }
	    }
	  },
	  "full_text__status": {
	    "description": "Inspect the current full-text retrieval-watch state, including counts, newly found PDFs, and whether the quiet window is satisfied for finalization.",
	    "example_call": {
	      "tool": "full_text__status",
	      "args": {
	        "scope": "pending"
	      }
	    }
	  },
	  "extraction__fields_update": {
	    "description": "Save manual extraction values for one item under a selected extraction template.",
	    "example_call": {
	      "tool": "extraction__fields_update",
	      "args": {
	        "item_key": "ITEM_KEY",
	        "template_name": "General",
	        "values": {
	          "aim": "Validation manual edit"
	        }
	      }
	    }
	  },
	  "extraction__results_list": {
	    "description": "List saved extraction results and recent extraction runs for the active project.",
	    "example_call": {
	      "tool": "extraction__results_list",
	      "args": {
	        "limit": 10
	      }
	    }
	  },
	  "extraction__run": {
	    "description": "Run batch extraction over the active project using one saved template, a chosen text source, and the data extraction runtime. You can target the whole project, a workflow scope, or one specific project subcollection.",
	    "example_call": {
	      "tool": "extraction__run",
	      "args": {
	        "template_name": "General",
	        "source_key": "title_abstract",
	        "scope": "included",
	        "row_scope": "missing_fields",
	        "limit": 1
	      }
	    }
	  },
	  "extraction__run_single": {
	    "description": "Run extraction for one specific item using a saved template and the data extraction runtime.",
	    "example_call": {
	      "tool": "extraction__run_single",
	      "args": {
	        "item_key": "ITEM_KEY",
	        "template_name": "General",
	        "source_key": "full_text"
	      }
	    }
	  },
	  "extraction__sources_list": {
	    "description": "List the extraction text sources available for the active project or selected subcollection.",
	    "example_call": {
	      "tool": "extraction__sources_list",
	      "args": {}
	    }
	  },
	  "extraction__template_bootstrap_default": {
	    "description": "Return the default extraction template for the active project, or the first project-local template when no explicit primary template is configured.",
	    "example_call": {
	      "tool": "extraction__template_bootstrap_default",
	      "args": {}
	    }
	  },
	  "extraction__template_export": {
	    "description": "Export one saved extraction template as YAML content from the active project.",
	    "example_call": {
	      "tool": "extraction__template_export",
	      "args": {
	        "name": "General"
	      }
	    }
	  },
	  "extraction__template_import": {
	    "description": "Import one extraction-template YAML payload into the active project and optionally create a new template file.",
	    "example_call": {
	      "tool": "extraction__template_import",
	      "args": {
	        "content": "name: Validation Imported Template\ndescription: Imported during manual validation.\nfields:\n  - key: note\n    label: Note\n    type: string\n    allow_null: true\n    guidance: |\n      Return a short note.\n",
	        "name": "Validation Imported Template",
	        "create_new": true
	      }
	    }
	  },
	  "extraction__template_load": {
	    "description": "Load one extraction template and return its metadata, fields, prompts, and YAML content.",
	    "example_call": {
	      "tool": "extraction__template_load",
	      "args": {
	        "name": "General"
	      }
	    }
	  },
	  "extraction__template_save": {
	    "description": "Save a new extraction template or update an existing one in the active project.",
	    "example_call": {
	      "tool": "extraction__template_save",
	      "args": {
	        "name": "Validation Template",
	        "description": "Manual validation template.",
	        "fields": [
	          {
	            "key": "summary",
	            "label": "Summary",
	            "type": "string",
	            "guidance": "Return a concise summary.",
	            "allow_null": true
	          }
	        ]
	      }
	    }
	  },
	  "extraction__templates_list": {
	    "description": "List the extraction templates currently available in the active project.",
	    "example_call": {
	      "tool": "extraction__templates_list",
	      "args": {}
	    }
	  },
	  "ui__close_tab": {
	    "description": "Close one open Systematic Reviewer tab by tab id across Zotero main windows.",
	    "example_call": {
	      "tool": "ui__close_tab",
	      "args": {
	        "tab_id": "systematic-reviewer-jobs-tab"
	      }
	    }
	  },
	  "ui__convert_attachment": {
	    "description": "Queue one attachment for markdown conversion using the selected collection scope and conversion mode.",
	    "example_call": {
	      "tool": "ui__convert_attachment",
	      "args": {
	        "attachment_key": "ATTACHMENT_KEY",
	        "collection_key": "COLLECTION_KEY",
	        "mode": "fast"
	      }
	    }
	  },
	  "ui__delete": {
	    "description": "Delete one Zotero item or attachment by key.",
	    "example_call": {
	      "tool": "ui__delete",
	      "args": {
	        "item_key": "ITEM_KEY"
	      }
	    }
	  },
	  "ui__link_file_attachment": {
	    "description": "Link a local file as an attachment under an existing Zotero parent item.",
	    "example_call": {
	      "tool": "ui__link_file_attachment",
	      "args": {
	        "item_key": "ITEM_KEY",
	        "path": "/absolute/path/to/file.pdf",
	        "title": "Linked PDF"
	      }
	    }
	  },
	  "ui__move_tab_to_external_window": {
	    "description": "Move one open Systematic Reviewer tab into a separate Zotero window.",
	    "example_call": {
	      "tool": "ui__move_tab_to_external_window",
	      "args": {
	        "tab_id": "systematic-reviewer-jobs-tab"
	      }
	    }
	  },
	  "ui__open_jobs_tab": {
	    "description": "Open or focus the project-scoped jobs tab.",
	    "example_call": {
	      "tool": "ui__open_jobs_tab",
	      "args": {}
	    }
	  },
	  "ui__open_markdown_viewer_tab": {
	    "description": "Open or focus the markdown viewer tab for one markdown attachment.",
	    "example_call": {
	      "tool": "ui__open_markdown_viewer_tab",
	      "args": {
	        "attachment_key": "ATTACHMENT_KEY"
	      }
	    }
	  },
	  "ui__open_workflow_tab": {
	    "description": "Open or focus the project-scoped workflow tab.",
	    "example_call": {
	      "tool": "ui__open_workflow_tab",
	      "args": {}
	    }
	  },
	  "ui__open_workspace_tab": {
	    "description": "Open or focus the project-scoped Automation tab inside the workflow surface.",
	    "example_call": {
	      "tool": "ui__open_workspace_tab",
	      "args": {}
	    }
	  },
	  "screening__bulk_run": {
	    "description": "Apply one bulk screening action to matching records and save the action as a job. Use Excluded for title/abstract exclusions and Excluded FT only for retrieved full-text eligibility failures; uncertain records should stay in Pending until resolved.",
	    "example_call": {
	      "tool": "screening__bulk_run",
	      "args": {
	        "action_kind": "move",
	        "query": "Gamma",
	        "limit": 1,
	        "scope": "pending",
	        "target_collection_key": "CMQCCSQE",
	        "target_collection_name": "Excluded",
	        "reason": "Validation bulk exclude",
	        "notes": "Bulk validation run"
	      }
	    }
	  },
	  "screening__column_create": {
	    "description": "Create or update one custom screening column.",
	    "example_call": {
	      "tool": "screening__column_create",
	      "args": {
	        "label": "Validation Flag",
	        "column_key": "validation_flag"
	      }
	    }
	  },
	  "screening__column_delete": {
	    "description": "Delete one custom screening column and its stored values.",
	    "example_call": {
	      "tool": "screening__column_delete",
	      "args": {
	        "column_key": "validation_flag"
	      }
	    }
	  },
	  "screening__columns_list": {
	    "description": "List the built-in and custom screening columns available in the active project.",
	    "example_call": {
	      "tool": "screening__columns_list",
	      "args": {}
	    }
	  },
	  "screening__comment_update": {
	    "description": "Save notes and reason text for one screening item.",
	    "example_call": {
	      "tool": "screening__comment_update",
	      "args": {
	        "item_key": "ITEM_KEY",
	        "reason": "Validation comment reason",
	        "notes": "Validation comment note"
	      }
	    }
	  },
	  "screening__complete_title_abstract": {
	    "description": "Summarize title/abstract screening after excluded records have moved to Excluded and remaining survivors are left in Pending for full-text retrieval.",
	    "example_call": {
	      "tool": "screening__complete_title_abstract",
	      "args": {
	        "scope": "pending"
	      }
	    }
	  },
	  "screening__filter_delete": {
	    "description": "Delete one materialized screening filter and optionally delete its Zotero subcollection.",
	    "example_call": {
	      "tool": "screening__filter_delete",
	      "args": {
	        "filter_id": "FILTER_ID",
	        "delete_collection": true
	      }
	    }
	  },
	  "screening__filter_materialize": {
	    "description": "Create or resync one materialized screening filter as a Zotero subcollection.",
	    "example_call": {
	      "tool": "screening__filter_materialize",
	      "args": {
	        "name": "Validation Filter",
	        "query": "beta",
	        "scope": "pending"
	      }
	    }
	  },
	  "screening__filters_list": {
	    "description": "List the materialized screening filters and their linked Zotero subcollections.",
	    "example_call": {
	      "tool": "screening__filters_list",
	      "args": {}
	    }
	  },
	  "screening__item_open": {
	    "description": "Select one screening item in the Zotero library UI.",
	    "example_call": {
	      "tool": "screening__item_open",
	      "args": {
	        "item_key": "ITEM_KEY"
	      }
	    }
	  },
	  "screening__list": {
	    "description": "List screening records and their current decision state for the active project or selected subcollection.",
	    "example_call": {
	      "tool": "screening__list",
	      "args": {
	        "scope": "pending",
	        "limit": 10
	      }
	    }
	  },
	  "screening__pdf_open": {
	    "description": "Open the first PDF attached to the selected screening item in Zotero.",
	    "example_call": {
	      "tool": "screening__pdf_open",
	      "args": {
	        "item_key": "ITEM_KEY"
	      }
	    }
	  },
	  "screening__rule_update": {
	    "description": "Create, update, enable, disable, or delete one screening rule.",
	    "example_call": {
	      "tool": "screening__rule_update",
	      "args": {
	        "label": "Validation Rule",
	        "column_key": "title",
	        "operator": "contains",
	        "match_value": "Delta",
	        "decision": "exclude",
	        "enabled": true
	      }
	    }
	  },
	  "screening__rules_recompute": {
	    "description": "Apply the saved screening rules to matching records and save the run as a job.",
	    "example_call": {
	      "tool": "screening__rules_recompute",
	      "args": {
	        "scope": "pending",
	        "query": "Delta",
	        "limit": 10
	      }
	    }
	  },
	  "screening__run_load": {
	    "description": "Load one saved screening-search result from the project outputs folder.",
	    "example_call": {
	      "tool": "screening__run_load",
	      "args": {
	        "name": "2026-04-20T21-24-42-189Z-validation-search-a.json"
	      }
	    }
	  },
	  "screening__runs_compare": {
	    "description": "Compare multiple saved screening-search runs from the project outputs folder.",
	    "example_call": {
	      "tool": "screening__runs_compare",
	      "args": {
	        "names": [
	          "2026-04-20T21-24-42-189Z-validation-search-a.json",
	          "2026-04-20T21-24-42-296Z-validation-search-b.json"
	        ],
	        "limit": 10,
	        "page": 1
	      }
	    }
	  },
	  "screening__runs_list": {
	    "description": "List the saved screening-search run files in the project outputs folder.",
	    "example_call": {
	      "tool": "screening__runs_list",
	      "args": {}
	    }
	  },
	  "screening__save_edits": {
	    "description": "Save batch screening edits for one or more records, including notes, reasons, moves, and custom column values.",
	    "example_call": {
	      "tool": "screening__save_edits",
	      "args": {
	        "edits": [
	          {
	            "item_key": "ITEM_KEY",
	            "decision": "unreviewed",
	            "target_collection_key": "JDZTBWSN",
	            "target_collection_name": "Pending",
	            "reason": "Validation batch edit",
	            "notes": "Validation batch note",
	            "values": {
	              "validation_flag": "yes"
	            }
	          }
	        ],
	        "scope": "pending",
	        "limit": 10
	      }
	    }
	  },
	  "screening__search": {
	    "description": "Search screening records with paging and optionally save the search result as a reusable run artifact.",
	    "example_call": {
	      "tool": "screening__search",
	      "args": {
	        "query": "validation",
	        "scope": "pending",
	        "limit": 10,
	        "save_run": true,
	        "name": "validation-search-a"
	      }
	    }
	  },
	  "screening__table_from_database": {
	    "description": "Build a static markdown table from scoped screening rows using the requested column order.",
	    "example_call": {
	      "tool": "screening__table_from_database",
	      "args": {
	        "columns": "title,year",
	        "scope": "pending"
	      }
	    }
	  },
	  "descriptives__run": {
	    "description": "Calculate descriptive screening statistics for one scope. Use `match_mode=\"and\"` when every rule must match, or `match_mode=\"or\"` when satisfying any rule is enough; rule order does not change the result. If rules are provided, numeric stats run over the matched papers only. If rules are blank and `stats_columns` is provided, the tool summarizes the whole selected scope. Leave `include_item_keys` false for broad/general summaries over large scopes because citation keys are normally not needed for sample-level descriptives. Set `include_item_keys` true for specific rule-filtered scopes where particular column values, contains-rules, or other narrow criteria likely produce a small subset and you need to show which papers support that analysis. If the review is small, including keys in every analysis is fine. For very large scopes that broadly represent an already-defined review sample, hundreds or thousands of keys usually add cost without improving a generic overview. Results and markdown are returned before optional item-key details so truncation preserves the descriptive results first.",
	    "example_text": "descriptives__run({\"scope\":\"included\",\"rules\":[{\"column_key\":\"year\",\"operator\":\"equals\",\"match_value\":\"2024\"}]}) Additional examples: descriptives__run({\"collection_key\":\"<COLLECTION_KEY>\",\"match_mode\":\"and\",\"rules\":[{\"column_key\":\"year\",\"operator\":\"gte\",\"match_value\":\"2020\"},{\"column_key\":\"year\",\"operator\":\"lte\",\"match_value\":\"2024\"}],\"stats_columns\":[\"year\"],\"include_item_keys\":true}) when a specific filtered subset needs traceability; descriptives__run({\"scope\":\"included\",\"match_mode\":\"or\",\"rules\":[{\"column_key\":\"title\",\"operator\":\"contains\",\"match_value\":\"coffee\"},{\"column_key\":\"abstract_note\",\"operator\":\"contains\",\"match_value\":\"diabetes\"}],\"stats_columns\":[\"year\"],\"include_item_keys\":true}) for narrow contains-rule subsets; descriptives__run({\"scope\":\"included\",\"stats_columns\":[\"year\"],\"include_item_keys\":false}) for a large whole-scope numeric overview with no item-key wall.",
	    "example_call": {
	      "tool": "descriptives__run",
	      "args": {
	        "scope": "included",
	        "match_mode": "and",
	        "rules": [
	          {
	            "column_key": "year",
	            "operator": "gte",
	            "match_value": "2020"
	          },
	          {
	            "column_key": "year",
	            "operator": "lte",
	            "match_value": "2024"
	          }
	        ],
	        "stats_columns": [
	          "year"
	        ],
	        "include_item_keys": false,
	        "save_output": true,
	        "name": "recent-included-studies"
	      }
	    }
	  },
	  "descriptives__runs_list": {
	    "description": "List saved descriptives markdown artifacts from the current project workflow outputs folder.",
	    "example_text": "descriptives__runs_list({}) or descriptives__runs_list({\"limit\":20})",
	    "example_call": {
	      "tool": "descriptives__runs_list",
	      "args": {}
	    }
	  },
	  "descriptives__run_load": {
	    "description": "Load one saved descriptives markdown artifact by absolute path or file name from the current project workflow outputs folder.",
	    "example_text": "descriptives__run_load({\"path\":\"<ABSOLUTE_DESCRIPTIVES_RUN_PATH>\"})",
	    "example_call": {
	      "tool": "descriptives__run_load",
	      "args": {
	        "path": "<ABSOLUTE_DESCRIPTIVES_RUN_PATH>"
	      }
	    }
	  },
	  "screening__update": {
	    "description": "Move one screening item to a target subcollection and save any reason, notes, and provenance metadata. Use Excluded for title/abstract exclusions, Excluded FT for retrieved full-text eligibility failures, and Included only after full-text eligibility passes.",
	    "example_call": {
	      "tool": "screening__update",
	      "args": {
	        "item_key": "ITEM_KEY",
	        "decision": "exclude",
	        "target_collection_key": "CMQCCSQE",
	        "target_collection_name": "Excluded",
	        "reason": "Validation direct exclude",
	        "notes": "Direct screening update validation",
	        "source_type": "agent",
	        "source_detail": "tool-catalog-validation"
	      }
	    }
	  },
	  "explore__chat_create": {
	    "description": "Create a new saved Explore chat for the active project.",
	    "example_call": {
	      "tool": "explore__chat_create",
	      "args": {
	        "name": "Validation Explore Chat"
	      }
	    }
	  },
	  "explore__chat_load": {
	    "description": "Load one saved Explore chat by chat id or path.",
	    "example_call": {
	      "tool": "explore__chat_load",
	      "args": {
	        "chat_id": "validation-explore-chat-2"
	      }
	    }
	  },
	  "explore__chat_run": {
	    "description": "Run one Explore chat prompt over selected project rows and save the reply plus batch artifacts.",
	    "example_call": {
	      "tool": "explore__chat_run",
	      "args": {
	        "chat_id": "validation-explore-chat-2",
	        "prompt": "List the matching study titles with their citation tokens.",
	        "query": "validation",
	        "limit": 2
	      }
	    }
	  },
	  "explore__chats_list": {
	    "description": "List the saved Explore chats for the active project.",
	    "example_call": {
	      "tool": "explore__chats_list",
	      "args": {}
	    }
	  },
	  "explore__citations_suggest": {
	    "description": "Suggest scoped citation tokens in `@[ITEMKEY]` form for the active project or selected subcollection.",
	    "example_call": {
	      "tool": "explore__citations_suggest",
	      "args": {
	        "prefix": "Validation",
	        "limit": 5
	      }
	    }
	  },
	  "explore__columns_list": {
	    "description": "List the data columns available to the native Explore query surface.",
	    "example_call": {
	      "tool": "explore__columns_list",
	      "args": {}
	    }
	  },
	  "explore__config_get": {
	    "description": "Load Explore scopes, columns, saved chats, citation rules, and runtime choices for the active project.",
	    "example_call": {
	      "tool": "explore__config_get",
	      "args": {}
	    }
	  },
	  "explore__export_csv": {
	    "description": "Export the current Explore query selection to a CSV file in the project outputs folder.",
	    "example_call": {
	      "tool": "explore__export_csv",
	      "args": {
	        "query": "validation",
	        "limit": 2,
	        "name": "validation-export"
	      }
	    }
	  },
	  "explore__job_load": {
	    "description": "Load one saved Explore job and its recent logs for the active project.",
	    "example_call": {
	      "tool": "explore__job_load",
	      "args": {
	        "job_id": "explore-mo7pkdw8-ncl6sq",
	        "log_limit": 20
	      }
	    }
	  },
	  "explore__list_batches": {
	    "description": "List the saved batches for one automation-native Explore run.",
	    "example_call": {
	      "tool": "explore__list_batches",
	      "args": {
	        "chat_id": "validation-explore-native-run"
	      }
	    }
	  },
	  "explore__list_runs": {
	    "description": "List the saved automation-native Explore runs for the active project.",
	    "example_call": {
	      "tool": "explore__list_runs",
	      "args": {}
	    }
	  },
	  "explore__load_batch": {
	    "description": "Load one saved batch output from an automation-native Explore run.",
	    "example_call": {
	      "tool": "explore__load_batch",
	      "args": {
	        "chat_id": "validation-explore-native-run",
	        "batch_index": "0"
	      }
	    }
	  },
	  "explore__publish_appendix": {
	    "description": "Publish an automation-native Explore summary or batch into the report appendices.",
	    "example_call": {
	      "tool": "explore__publish_appendix",
	      "args": {
	        "chat_id": "validation-explore-native-run",
	        "mode": "batch",
	        "batch_index": "0"
	      }
	    }
	  },
	  "explore__query": {
	    "description": "Run a native Explore query over project records, with optional saved output for later review.",
	    "example_call": {
	      "tool": "explore__query",
	      "args": {
	        "query": "validation",
	        "limit": 2,
	        "save_run": "true",
	        "name": "validation-explore-query"
	      }
	    }
	  },
	  "explore__run": {
	    "description": "Run one automation-native Explore analysis over a selected scope using the active session runtime.",
	    "example_call": {
	      "tool": "explore__run",
	      "args": {
	        "prompt": "Create a markdown table with Title and Citation using @{title} and @{citation_token}.",
	        "collection_key": "JDZTBWSN",
	        "chat_name": "Validation Explore Native Run"
	      }
	    }
	  },
	  "explore__run_load": {
	    "description": "Load one saved Explore query output by file name or path.",
	    "example_call": {
	      "tool": "explore__run_load",
	      "args": {
	        "name": "2026-04-20T21-29-51-098Z-validation-explore-query.json"
	      }
	    }
	  },
	  "explore__runs_list": {
	    "description": "List the saved Explore query outputs for the active project.",
	    "example_call": {
	      "tool": "explore__runs_list",
	      "args": {}
	    }
	  },
	  "explore__session_load": {
	    "description": "Load one saved session transcript and timeline for the active project.",
	    "example_call": {
	      "tool": "explore__session_load",
	      "args": {
	        "session_id": "session-mo7om4dy-n0zqji",
	        "transcript_limit": 5,
	        "timeline_limit": 5
	      }
	    }
	  },
	  "explore__snapshot": {
	    "description": "Inspect the active project's report, sessions, jobs, and artifact files.",
	    "example_call": {
	      "tool": "explore__snapshot",
	      "args": {
	        "session_limit": 5,
	        "job_limit": 5,
	        "artifact_limit": 5
	      }
	    }
	  },
	  "automation_document__document_rollback_list": {
	    "description": "List REPORT.md rollback snapshots for the current project so you can choose a real snapshot ID before diffing or restoring a prior report state.",
	    "example_call": {
	      "tool": "automation_document__document_rollback_list",
	      "args": {
	        "limit": 10
	      }
	    }
	  },
	  "automation_document__document_rollback_diff": {
	    "description": "Diff the current saved REPORT.md against one rollback snapshot so you can inspect the exact change before restoring it.",
	    "example_call": {
	      "tool": "automation_document__document_rollback_diff",
	      "args": {
	        "snapshot_id": "report-2026-01-01T00-00-00-000Z-manual-save.md"
	      }
	    }
	  },
	  "automation_document__document_rollback_restore": {
	    "description": "Restore REPORT.md from one rollback snapshot using a real snapshot filename, while preserving the overwritten current report in rollback history when needed.",
	    "example_call": {
	      "tool": "automation_document__document_rollback_restore",
	      "args": {
	        "snapshot_id": "report-2026-01-01T00-00-00-000Z-manual-save.md"
	      }
	    }
	  }
	});

	function optionalString(value) {
		return String(value || "").trim();
	}

	function cloneJSONValue(value) {
		if (value === undefined) {
			return undefined;
		}
		try {
			return JSON.parse(JSON.stringify(value));
		}
		catch (_error) {
			return value;
		}
	}

	function toolDescriptionOverride(wireName = "") {
		let entry = TOOL_DESCRIPTION_OVERRIDES[wireName] && typeof TOOL_DESCRIPTION_OVERRIDES[wireName] == "object"
			? TOOL_DESCRIPTION_OVERRIDES[wireName]
			: null;
		let exampleCall = entry?.example_call && typeof entry.example_call == "object" && !Array.isArray(entry.example_call)
			? cloneJSONValue(entry.example_call)
			: null;
		return {
			description: optionalString(entry?.description || ""),
			example_call: exampleCall,
			example_text: optionalString(entry?.example_text || "") || (exampleCall ? JSON.stringify(exampleCall) : ""),
		};
	}

	function embeddingsModelConfiguredForCatalog(options = {}) {
		try {
			return !!options?.reviewer?._hasConfiguredEmbeddingsModelSync?.();
		}
		catch (_error) {
			return false;
		}
	}

	function applyDynamicToolMetadata(wireName = "", metadata = {}, options = {}) {
		if (wireName != "documents__find" || embeddingsModelConfiguredForCatalog(options)) {
			return metadata;
		}
		let next = Object.assign({}, metadata || {});
		next.description = "Run Find Arguments with native keyword retrieval over project full-text chunks. Keyword search works without embeddings and returns concise markdown, grouped results, and a search_id for follow-up.";
		next.example_call = {
			tool: "documents__find",
			args: {
				mode: "keyword",
				query: "patient reported depression symptoms",
				scope: "included",
				limit: 5,
				chunks_per_document: 2,
			},
		};
		next.example_text = JSON.stringify(next.example_call);
		return next;
	}

	function splitCamel(text = "") {
		return String(text || "")
			.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
			.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
			.replace(/[^A-Za-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "")
			.toLowerCase();
	}

	function inferNamespace(tool = {}) {
		let id = optionalString(tool?.id || "");
		if (!id.startsWith("sr.")) {
			return "workspace";
		}
		let local = id.slice(3);
		if (TOP_LEVEL_IDS.has(id)) {
			return "";
		}
		if (/^harvest/i.test(local)) {
			return "harvest";
		}
		if (/^manual/i.test(local)) {
			return "manual";
		}
		if (/^extraction/i.test(local)) {
			return "extraction";
		}
		if (/^(embeddings|semantic)/i.test(local)) {
			return /^semantic/i.test(local) ? "semantic" : "embeddings";
		}
		if (/^documents/i.test(local)) {
			return "documents";
		}
		if (/^projectData/i.test(local)) {
			return "project_data";
		}
		if (/^items/i.test(local)) {
			return "items";
		}
		if (/^mcp/i.test(local)) {
			return "mcp";
		}
		if (/^fullText/i.test(local)) {
			return "full_text";
		}
		if (/^screening/i.test(local)) {
			return "screening";
		}
		if (/^descriptives/i.test(local)) {
			return "descriptives";
		}
		if (/^prisma/i.test(local)) {
			return "prisma";
		}
		if (/^explore/i.test(local)) {
			return "explore";
		}
		if (/^(jobs|job)/i.test(local)) {
			return "jobs";
		}
		if (/^(project|collection|session|scope)/i.test(local)) {
			return "project_admin";
		}
		if (/^shell/i.test(local)) {
			return "shell";
		}
		if (/^browser/i.test(local)) {
			return "browser";
		}
		if (/^ui/i.test(local) || /^item/i.test(local)) {
			return "ui";
		}
		if (/^(workflow|automation)/i.test(local)) {
			return "automation_document";
		}
		return "workspace";
	}

	function wireNameForTool(tool = {}, namespaceID = "") {
		let id = optionalString(tool?.id || "");
		let local = id.startsWith("sr.") ? id.slice(3) : id;
		if (!local) {
			return "";
		}
		if (!namespaceID) {
			return splitCamel(local);
		}
		let prefixMap = {
			manual: /^manual/i,
			harvest: /^harvest/i,
			extraction: /^extraction/i,
			embeddings: /^embeddings/i,
			semantic: /^semantic/i,
			documents: /^documents/i,
			project_data: /^projectData/i,
			items: /^items/i,
			mcp: /^mcp/i,
			screening: /^screening/i,
			descriptives: /^descriptives/i,
			full_text: /^fullText/i,
			prisma: /^prisma/i,
			explore: /^explore/i,
			jobs: /^(jobs|job)/i,
			shell: /^shell/i,
			browser: /^browser/i,
			automation_document: /^(automation|workflow)/i,
			ui: /^(ui|item)/i,
		};
		let stripped = prefixMap[namespaceID]
			? local.replace(prefixMap[namespaceID], "")
			: local.replace(new RegExp(`^${namespaceID}`, "i"), "");
		let suffix = splitCamel(stripped || local) || splitCamel(local);
		return `${namespaceID}__${suffix}`;
	}

	function functionSchemaForTool(tool = {}) {
		let shape = tool?.inputShape && typeof tool.inputShape == "object" ? tool.inputShape : {};
		let properties = {};
		let required = [];
		let inferDescription = (value) => {
			if (Array.isArray(value)) {
				return value.map((entry) => optionalString(entry)).filter(Boolean).join("\n");
			}
			return optionalString(value);
		};
		let inferType = (key, value) => {
			if (Array.isArray(value)) {
				return {
					type: "array",
					items: {
						type: "object",
					},
				};
			}
			let text = inferDescription(value).toLowerCase();
			if (/^\s*\[/.test(text) || text.includes("array of") || text.includes("[{")) {
				return {
					type: "array",
					items: {
						type: text.includes("string") && !text.includes("{")
							? "string"
							: "object",
					},
				};
			}
			if (/^\s*\{/.test(text) || text.includes(" object") || text.includes("{ ")) {
				return {
					type: "object",
				};
			}
			if (text.includes("boolean")) {
				return {
					type: "boolean",
				};
			}
			if (
				text.includes("integer")
				|| text.includes("number")
				|| /\b\d+-based\b/.test(text)
				|| /\blibrary id\b/.test(text)
				|| /\blimit\b/.test(text)
				|| /\bcount\b/.test(text)
				|| /\bmax\b/.test(text)
				|| /\bmin\b/.test(text)
				|| /\bpage\b/.test(text)
			) {
				return {
					type: "number",
				};
			}
			return {
				type: "string",
			};
		};
		for (let [key, description] of Object.entries(shape)) {
			let text = inferDescription(description);
			let propertySchema = Object.assign({
				description: text || "No description provided.",
			}, inferType(key, description));
			let normalized = text.toLowerCase();
			if (normalized.includes("required") && !normalized.includes("optional")) {
				required.push(key);
				if (propertySchema.type == "array") {
					propertySchema.minItems = 1;
				}
			}
			properties[key] = propertySchema;
		}
		let schema = {
			type: "object",
			properties,
			additionalProperties: Object.keys(properties).length == 0,
		};
		if (required.length) {
			schema.required = Array.from(new Set(required));
		}
		return schema;
	}

	function normalizeTool(tool = {}, options = {}) {
		let rawDescription = optionalString(tool?.description || "") || "No description provided.";
		let namespaceID = inferNamespace(tool);
		let wireName = wireNameForTool(tool, namespaceID);
		let parameters = functionSchemaForTool(tool);
		let approvedEntry = applyDynamicToolMetadata(wireName, toolDescriptionOverride(wireName, parameters), options);
		let description = optionalString(approvedEntry?.description || "") || rawDescription;
		let exampleCall = approvedEntry?.example_call && typeof approvedEntry.example_call == "object" && !Array.isArray(approvedEntry.example_call)
			? cloneJSONValue(approvedEntry.example_call)
			: null;
		let exampleText = optionalString(approvedEntry?.example_text || "");
		let fullDescription = description;
		if (exampleText) {
			fullDescription = `${description} Example call: ${exampleText}`;
		}
		let callArgumentsExample = exampleCall?.args && typeof exampleCall.args == "object" && !Array.isArray(exampleCall.args)
			? cloneJSONValue(exampleCall.args)
			: (Object.keys(parameters?.properties || {}).length ? null : {});
		return {
			legacy_id: optionalString(tool?.id || ""),
			namespace: namespaceID,
			name: wireName,
			type: "function",
			description,
			full_description: fullDescription,
			raw_description: rawDescription,
			parameters,
			legacy_args: Array.isArray(tool?.args) ? tool.args.slice() : Object.keys(tool?.inputShape || {}),
			inputShape: tool?.inputShape || {},
			example_call: exampleCall,
			call_arguments_example: callArgumentsExample,
		};
	}

	function buildNamespaceCatalog(toolList = [], options = {}) {
		let tools = (Array.isArray(toolList) ? toolList : [])
			.map((tool) => normalizeTool(tool, options))
			.filter((tool) => tool.name && tool.legacy_id);
		let namespaces = new Map();
		let topLevel = [];
		let byName = {};
		for (let tool of tools) {
			byName[tool.name] = tool;
			if (!tool.namespace) {
				topLevel.push(tool);
				continue;
			}
			if (!namespaces.has(tool.namespace)) {
				let description = NAMESPACE_DESCRIPTIONS[tool.namespace] || "Related project tools.";
				if (tool.namespace == "documents" && !embeddingsModelConfiguredForCatalog(options)) {
					description = "Find Arguments retrieval over project full-text chunks with native keyword mode, pagination, and markdown-viewer hit opening.";
				}
				namespaces.set(tool.namespace, {
					id: tool.namespace,
					name: tool.namespace,
					description,
					tools: [],
				});
			}
			namespaces.get(tool.namespace).tools.push(tool);
		}
		let orderedNamespaces = Array.from(namespaces.values())
			.sort((left, right) => {
				let leftIndex = NAMESPACE_ORDER.indexOf(left.id);
				let rightIndex = NAMESPACE_ORDER.indexOf(right.id);
				let rankLeft = leftIndex >= 0 ? leftIndex : 999;
				let rankRight = rightIndex >= 0 ? rightIndex : 999;
				return rankLeft - rankRight || left.id.localeCompare(right.id);
			});
		topLevel.sort((a, b) => a.name.localeCompare(b.name));
		for (let namespace of orderedNamespaces) {
			namespace.tools.sort((a, b) => a.name.localeCompare(b.name));
		}
		return {
			top_level: topLevel,
			namespaces: orderedNamespaces,
			by_name: byName,
		};
	}

	function listNamespaceTools(catalog = {}, namespaceID = "") {
		let target = optionalString(namespaceID);
		if (!target) {
			return [];
		}
		let namespaces = Array.isArray(catalog?.namespaces) ? catalog.namespaces : [];
		let entry = namespaces.find((namespace) => optionalString(namespace?.id) == target) || null;
		return Array.isArray(entry?.tools) ? entry.tools.slice() : [];
	}

	function resolveAdvertisedTools(catalog = {}, options = {}) {
		let advertised = [];
		let seen = new Set();
		let pushTool = (tool) => {
			let name = optionalString(tool?.name);
			if (!name || seen.has(name)) {
				return;
			}
			seen.add(name);
			advertised.push(tool);
		};
		for (let tool of (Array.isArray(catalog?.top_level) ? catalog.top_level : [])) {
			pushTool(tool);
		}
		for (let name of (Array.isArray(options?.always_available_tool_names) ? options.always_available_tool_names : [])) {
			pushTool(catalog?.by_name?.[optionalString(name)] || null);
		}
		for (let namespaceID of (Array.isArray(options?.active_namespaces) ? options.active_namespaces : [])) {
			for (let tool of listNamespaceTools(catalog, namespaceID)) {
				pushTool(tool);
			}
		}
		for (let name of (Array.isArray(options?.active_tool_names) ? options.active_tool_names : [])) {
			pushTool(catalog?.by_name?.[optionalString(name)] || null);
		}
		return advertised;
	}

	function flattenedTools(catalog = {}) {
		let topLevel = Array.isArray(catalog?.top_level) ? catalog.top_level : [];
		let namespaces = Array.isArray(catalog?.namespaces) ? catalog.namespaces : [];
		let flattened = topLevel.slice();
		for (let namespace of namespaces) {
			flattened.push(...(Array.isArray(namespace?.tools) ? namespace.tools : []));
		}
		return flattened.sort((a, b) => a.name.localeCompare(b.name));
	}

	function toolSearchDefinition() {
		return {
			type: "function",
			name: "tool_search",
			description: [
				"Inspect the canonical tool catalog before choosing a domain-specific function.",
				"Use this function when you need the detailed tool list, argument descriptions, and usage guidance for a namespace or task phrase.",
				"Arguments: provide namespace to inspect one tool family, query to search by task phrase, or both to narrow results within a namespace.",
				"Examples: namespace=harvest query='estimate import results'; namespace=documents query='find arguments keyword chunks'; namespace=mcp query='external server tools resources prompts'; namespace=descriptives query='counts percents scope rules'; namespace=extraction query='template run field update'; query='edit REPORT markdown'.",
			].join(" "),
			parameters: {
				type: "object",
				properties: {
					namespace: {
						type: "string",
						minLength: 1,
						description: "Optional namespace id such as manual, harvest, screening, descriptives, embeddings, semantic, documents, mcp, full_text, extraction, explore, prisma, jobs, project_admin, workspace, automation_document, or ui.",
					},
					query: {
						type: "string",
						minLength: 1,
						description: "Optional free-text search phrase such as estimate import results, screening move item, or update report markdown.",
					},
					limit: {
						type: "number",
						minimum: 1,
						description: "Optional maximum number of matching tools to return.",
					},
				},
				additionalProperties: false,
			},
		};
	}

	function searchCatalog(catalog = {}, args = {}) {
		let namespaceID = optionalString(args?.namespace || "").toLowerCase();
		let query = optionalString(args?.query || "").toLowerCase();
		if (!namespaceID && !query) {
			throw new Error("tool_search requires at least one populated selector: namespace, query, or both.");
		}
		let limit = Math.max(1, Math.min(12, Number(args?.limit || 8) || 8));
		let namespaces = Array.isArray(catalog?.namespaces) ? catalog.namespaces : [];
		let topLevel = Array.isArray(catalog?.top_level) ? catalog.top_level : [];
		let candidates = [];
		let selectedNamespace = namespaceID
			? namespaces.find((entry) => entry.id == namespaceID) || null
			: null;
		if (namespaceID) {
			if (selectedNamespace) {
				candidates.push(...(Array.isArray(selectedNamespace.tools) ? selectedNamespace.tools : []));
			}
		}
		else if (query) {
			candidates.push(...topLevel);
			for (let entry of namespaces) {
				candidates.push(...(Array.isArray(entry.tools) ? entry.tools : []));
			}
		}
		if (query) {
			let queryTerms = query.split(/\s+/).map((term) => term.trim()).filter(Boolean);
			let scoredCandidates = candidates.map((tool) => {
				let haystack = [
					tool.name,
					tool.namespace,
					tool.description,
					tool.full_description,
					...Object.keys(tool.parameters?.properties || {}),
				].join(" ").toLowerCase();
				let score = haystack.includes(query) ? 100 : 0;
				for (let term of queryTerms) {
					if (term && haystack.includes(term)) {
						score += 1;
					}
				}
				return { tool, score };
			})
				.filter((entry) => entry.score > 0)
				.sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name));
			candidates = scoredCandidates.map((entry) => entry.tool);
			if (namespaceID && !candidates.length && selectedNamespace) {
				candidates = Array.isArray(selectedNamespace.tools) ? selectedNamespace.tools.slice() : [];
			}
		}
		let namespaceMatches = namespaceID
			? namespaces.filter((entry) => entry.id == namespaceID)
			: namespaces.filter((entry) => {
				if (!query) {
					return true;
				}
				let haystack = `${entry.id} ${entry.description}`.toLowerCase();
				return haystack.includes(query);
			});
		let returnedTools = candidates.slice(0, limit);
		return {
			ok: true,
			query: optionalString(args?.query || ""),
			namespace: namespaceID,
			namespace_description: optionalString(selectedNamespace?.description || ""),
			activate_namespaces: selectedNamespace?.id ? [selectedNamespace.id] : [],
			activate_tools: returnedTools.map((tool) => tool.name).filter(Boolean),
			namespaces: namespaceMatches.slice(0, 8).map((entry) => ({
				id: entry.id,
				description: entry.description,
				tool_count: Array.isArray(entry.tools) ? entry.tools.length : 0,
			})),
			tools: returnedTools.map((tool) => {
				let properties = tool?.parameters?.properties && typeof tool.parameters.properties == "object"
					? tool.parameters.properties
					: {};
				let required = new Set(Array.isArray(tool?.parameters?.required) ? tool.parameters.required : []);
					return {
					name: tool.name,
					namespace: tool.namespace || "top_level",
					description: optionalString(tool.full_description || tool.description),
					call_example: tool?.example_call && typeof tool.example_call == "object"
						? cloneJSONValue(tool.example_call)
						: null,
					required_arguments: Array.from(required),
					call_arguments_example: tool?.call_arguments_example && typeof tool.call_arguments_example == "object"
						? cloneJSONValue(tool.call_arguments_example)
						: (Object.keys(properties).length ? null : {}),
					arguments: Object.entries(properties).map(([name, meta]) => ({
						name,
						required: required.has(name),
						description: optionalString(meta?.description || "") || "No description provided.",
				})),
				legacy_id: tool.legacy_id,
				};
			}),
			hint: namespaceID
				? `Showing the ${namespaceID} tools. Use the exact function names from this list for follow-up calls.`
				: "Use namespace=\"...\" to narrow the results if you need one tool family only.",
		};
	}

	function buildSessionPromptIntro(catalog = {}) {
		let parts = [];
		let topLevel = Array.isArray(catalog?.top_level) ? catalog.top_level : [];
		let namespaces = Array.isArray(catalog?.namespaces) ? catalog.namespaces : [];
		parts.push(
			"Tooling rules:",
			"- Use the real function tools instead of inventing file paths, scopes, or collection names.",
			"- Use tool_search first when you need richer descriptions for one namespace or you are unsure which tool fits the task.",
			"- tool_search expects a structured object with at least one populated selector: namespace, query, or both.",
			"- Use namespace when you know the tool family, query when you know the task phrase, and both when you want the results narrowed within one namespace.",
			"- Use manual tools for workflow guidance and decision doctrine, workspace/report tools for report editing and file inspection, then use domain namespaces for harvest, screening, descriptives, embeddings, semantic search, Find Arguments document retrieval, full-text operations, extraction, explore, PRISMA, and jobs.",
			"- Function names that contain a namespace use the format namespace__tool_name.",
			"- If a tool result shows a real item key, collection key, run id, or job id, reuse that exact value in follow-up calls.",
			"- When the user asks what tools a namespace offers, call tool_search for that namespace and then summarize the returned tools instead of guessing."
		);
		if (topLevel.length) {
			parts.push(
				"",
				"Always-available workspace tools:",
				...topLevel.map((tool) => `- ${tool.name}: ${tool.description}`)
			);
		}
		if (namespaces.length) {
			parts.push(
				"",
				"Namespaces:",
				...namespaces.map((entry) => `- ${entry.id}: ${entry.description} Use tool_search with namespace=${entry.id} when you need the detailed tools for this area.`)
			);
		}
		parts.push(
			"",
			"How to inspect tools:",
			"- For systematic-review workflow guidance, call tool_search({\"namespace\":\"manual\",\"query\":\"stage guidance report writing\"}).",
			"- For harvest estimates/imports, call tool_search({\"namespace\":\"harvest\",\"query\":\"estimate import results\"}).",
			"- For full-text retrieval and conversion, call tool_search({\"namespace\":\"full_text\",\"query\":\"retrieval conversion unretrieved included\"}).",
			"- For Find Arguments retrieval over document chunks, call tool_search({\"namespace\":\"documents\",\"query\":\"find arguments keyword full text chunks\"}).",
			"- For safe paged project-row inspection, call tool_search({\"namespace\":\"project_data\",\"query\":\"schema rows columns scope\"}) and inspect schema before rows.",
			"- For Zotero item creation, import, or metadata read/write, call tool_search({\"namespace\":\"items\",\"query\":\"create import read write metadata native fields\"}).",
			"- For user-configured external MCP servers, call tool_search({\"namespace\":\"mcp\",\"query\":\"list servers inspect call tools resources prompts\"}) and inspect/search one server before calling third-party tools.",
			"- For extraction templates, runs, or field updates, call tool_search({\"namespace\":\"extraction\",\"query\":\"template run field update\"}).",
			"- For screening decisions or bulk moves, call tool_search({\"namespace\":\"screening\",\"query\":\"decision bulk move item\"}).",
			"- For descriptive statistics over screening columns, call tool_search({\"namespace\":\"descriptives\",\"query\":\"scope rules counts percents markdown\"}).",
			"- For privileged browsing, docs lookup, or webpage save tools, call tool_search({\"namespace\":\"browser\",\"query\":\"open read page save\"}).",
			"- For report editing or file tools, call tool_search({\"namespace\":\"workspace\",\"query\":\"REPORT markdown patch search_file\"}). Use workspace__search_file to find report markers/sections cheaply before reading large files.",
			"- If the namespace is unknown but the task is known, call tool_search({\"query\":\"semantic search evidence\"}).",
			"",
			"tool_search examples:",
			"- tool_search({\"namespace\":\"manual\",\"query\":\"screening workflow guidance\"})",
			"- tool_search({\"namespace\":\"harvest\",\"query\":\"estimate import results\"})",
			"- tool_search({\"namespace\":\"documents\",\"query\":\"find arguments keyword chunks\"})",
			"- tool_search({\"namespace\":\"project_data\",\"query\":\"schema rows columns\"})",
			"- tool_search({\"namespace\":\"items\",\"query\":\"create import identifiers read write metadata\"})",
			"- tool_search({\"namespace\":\"mcp\",\"query\":\"list servers call tool resources prompts\"})",
			"- tool_search({\"namespace\":\"full_text\",\"query\":\"finalize unretrieved included\"})",
			"- tool_search({\"namespace\":\"extraction\",\"query\":\"template run field update\"})",
			"- tool_search({\"namespace\":\"screening\",\"query\":\"move one item update decision\"})",
			"- tool_search({\"namespace\":\"descriptives\",\"query\":\"counts percents scope rules markdown\"})",
			"- tool_search({\"namespace\":\"browser\",\"query\":\"read page save\"})",
			"- tool_search({\"query\":\"edit REPORT markdown\"})"
		);
		return parts.join("\n");
	}

	return {
		buildNamespaceCatalog,
		listNamespaceTools,
		resolveAdvertisedTools,
		flattenedTools,
		toolSearchDefinition,
		searchCatalog,
		buildSessionPromptIntro,
		inferNamespace,
		wireNameForTool,
	};
})();

if (typeof module != "undefined" && module.exports) {
	module.exports = SystematicReviewerResponsesToolCatalog;
}
