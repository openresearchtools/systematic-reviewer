var SystematicReviewerPrivilegedBrowserPrompts = (() => {
	function sessionBrowserIntro() {
		return [
			"Privileged browser tools:",
			"- The browser namespace is not available through MCP.",
			"- When privileged browser tools are enabled and developer tools are unlocked, the localhost developer testing surface mirrors the same allowed browser tools as the in-app session agent.",
			"- Use browser tools for real webpage research, documentation lookup, interactive browsing, screenshots, and saving pages into the current project.",
			"- Use browser__expand_page to reveal bounded read-more or details content before reading or saving the page.",
			"- Use browser__load_more to continue comments, lists, or feed-like pages with explicit bounds instead of scrolling forever.",
			"- Use browser__read_page for transient webpage reading and docs lookup without creating Zotero items or project artifacts. Large reads automatically write the full markdown to the active session folder and return markdown_path.",
			"- Use browser__save_page_to_project when you want the current page preserved in the project as a Zotero webpage item with attachments.",
			"- Saved pages default to Harvest/Web plus the normal merge-to-Pending follow-up in systematic-review projects, and to Data in custom-analysis projects.",
			"- Saved pages automatically preserve a native snapshot and PDF, then queue the normal PDF markdown conversion from the saved PDF attachment.",
			"- Browser tools can open arbitrary sites and interact with live pages, so treat them as privileged and avoid browsing untrusted pages unless the task actually needs that.",
		].join("\n");
	}

	return {
		sessionBrowserIntro,
	};
})();
