var SystematicReviewerJobsHost = {
	async _mountJobsTab(win, container, projectRef = null) {
		let doc = win?.document;
		if (!doc || !container) {
			throw new Error("Jobs tab could not be mounted");
		}

		this._ensureWorkspaceStyles(doc);
		container.style.padding = "0";
		container.style.margin = "0";
		container.style.display = "flex";
		container.style.flex = "1";
		container.style.width = "100%";
		container.style.minHeight = "0";
		container.style.height = "100%";
		container.style.background = "transparent";

		let mount = container._systematicReviewerMount;
		let mustRebuild = !mount || !mount.isConnected;
		if (!mustRebuild && mount._systematicReviewerInstanceToken !== this.instanceToken) {
			this._destroyController(mount);
			mustRebuild = true;
		}
		if (mustRebuild) {
			mount = this._html(doc, "div");
			mount.style.display = "flex";
			mount.style.flex = "1";
			mount.style.width = "100%";
			mount.style.minHeight = "0";
			mount.style.height = "100%";
			mount.style.background = "transparent";
			container.replaceChildren(mount);
			container._systematicReviewerMount = mount;
			mount._systematicReviewerInstanceToken = this.instanceToken;
		}
		let spec = this._projectTabSpec("jobs", null);
		mount._systematicReviewerTabID = spec.id;
		mount._systematicReviewerProjectRef = this._projectReferenceData(projectRef) || null;

		let controller = mount._systematicReviewerController;
		if (!controller) {
			controller = this._createJobsController(doc, mount, { hostType: "tab" });
			mount._systematicReviewerController = controller;
			this.paneControllers.add(controller);
		}
		controller.projectRef = this._projectReferenceData(projectRef) || controller.projectRef || null;
		await this._refreshController(controller);
	},

	_createJobsController(doc, body, { hostType = "tab" } = {}) {
		let root = this._html(doc, "div", { className: "sr-jobs-root" });
		let refreshBtn = this._html(doc, "button", {
			className: "sr-workspace-btn",
			text: "Refresh",
			attrs: { type: "button" },
		});
		let status = this._html(doc, "div", {
			className: "sr-workspace-status",
			text: "Jobs ready",
		});
		let summary = this._html(doc, "div", { className: "sr-jobs-summary" });
		let topbar = this._html(doc, "div", {
			className: "sr-workspace-topbar sr-jobs-topbar",
			children: [
				summary,
				this._html(doc, "div", {
					className: "sr-workspace-toolbar",
					children: [refreshBtn, status],
				}),
			],
		});

		let list = this._html(doc, "div", { className: "sr-jobs-list" });
		let detailTitle = this._html(doc, "div", { className: "sr-workspace-card-title", text: "No job selected" });
		let detailActions = this._html(doc, "div", { className: "sr-workspace-toolbar" });
		let detailMeta = this._html(doc, "div", { className: "sr-jobs-detail-meta" });
		let detailNote = this._html(doc, "div", { className: "sr-jobs-harvest-note", attrs: { hidden: "hidden" } });
		let detailBody = this._html(doc, "div", { className: "sr-jobs-logbox", text: "Select a job to inspect logs." });
		let detail = this._html(doc, "div", {
			className: "sr-jobs-detail",
			children: [
				this._html(doc, "div", {
					className: "sr-workspace-card-header",
					children: [
						this._html(doc, "div", { children: [detailTitle] }),
						detailActions,
					],
				}),
				this._html(doc, "div", {
					className: "sr-jobs-detail-body",
					children: [detailMeta, detailNote, detailBody],
				}),
			],
		});

		let grid = this._html(doc, "div", {
			className: "sr-jobs-grid",
			children: [list, detail],
		});

		root.append(topbar, grid);
		body.replaceChildren(root);

		let controller = {
			doc,
			body,
			root,
			hostType,
			instanceToken: this.instanceToken,
			kind: "jobs",
			projectRef: null,
			bootstrap: null,
			pollTimer: null,
			selectedJobID: "",
			selectedProjectID: "",
			selectedJob: null,
			refresh: () => this._refreshController(controller),
			els: {
				refreshBtn,
				status,
				summary,
				list,
				detailActions,
				detailTitle,
				detailMeta,
				detailNote,
				detailBody,
			},
		};

		refreshBtn.addEventListener("click", () => {
			this._refreshController(controller).catch((error) => this._showError(error));
		});
		controller.pollTimer = controller.doc.defaultView.setInterval(() => {
			if (!controller.body?.isConnected) {
				return;
			}
			this._refreshController(controller).catch((error) => {
				this.log(`jobs poll skipped: ${error}`);
			});
		}, 3000);
		return controller;
	},

	async _buildJobsPayload(controller = null) {
		let global = await SystematicReviewerWorkflowJobs.listGlobalJobs(this, {
			limit: 250,
			per_project_limit: 120,
		});
		let jobs = Array.isArray(global?.jobs) ? global.jobs : [];
		let requestedProjectID = String(controller?.selectedProjectID || "").trim();
		let requestedJobID = String(controller?.selectedJobID || "").trim();
		let selected = jobs.find((entry) =>
			String(entry?.project_id || "").trim() == requestedProjectID
			&& String(entry?.job_id || "").trim() == requestedJobID
		) || jobs[0] || null;
		let selectedJob = null;
		if (selected?.project_id && selected?.job_id) {
			let loaded = await SystematicReviewerWorkflowJobs.loadGlobalJob(this, {
				project_id: selected.project_id,
				job_id: selected.job_id,
				log_limit: 300,
			}).catch(() => null);
			selectedJob = loaded?.job || null;
		}
		return {
			job_counts: global?.counts || { queued: 0, running: 0, succeeded: 0, partial: 0, failed: 0, canceled: 0 },
			jobs,
			selected_project_id: selected?.project_id || "",
			selected_job_id: selected?.job_id || "",
			selected_job: selectedJob,
			project_catalog: Array.isArray(global?.projects) ? global.projects : [],
		};
	},

	async _refreshJobsController(controller) {
		this._setStatus(controller, "Loading jobs...");
		try {
			let payload = await this._buildJobsPayload(controller);
			controller.bootstrap = payload;
			controller.selectedProjectID = String(payload.selected_project_id || "").trim();
			controller.selectedJobID = String(payload.selected_job_id || "").trim();
			controller.selectedJob = payload.selected_job || null;
			this._applyJobsPayload(controller, payload);
			this._setStatus(controller, "Jobs ready", "ready");
		}
		catch (error) {
			this._setStatus(controller, "Jobs failed", "error");
			controller.els.list.replaceChildren(
				this._html(controller.doc, "div", {
					className: "sr-workspace-empty",
					text: `Failed to load jobs: ${error?.message || String(error)}`,
				})
			);
			controller.els.detailTitle.textContent = "No job selected";
			controller.els.detailActions.replaceChildren();
			controller.els.detailMeta.textContent = "";
			controller.els.detailNote.hidden = true;
			controller.els.detailNote.textContent = "";
			controller.els.detailBody.textContent = "";
		}
	},

	_applyJobsPayload(controller, payload) {
		let counts = payload.job_counts || { queued: 0, running: 0, succeeded: 0, partial: 0, failed: 0, canceled: 0 };
		this._applyControllerTheme(controller);
		controller.els.summary.replaceChildren(
			this._summaryBadge(controller.doc, "Queued", counts.queued),
			this._summaryBadge(controller.doc, "Running", counts.running),
			this._summaryBadge(controller.doc, "Succeeded", counts.succeeded),
			this._summaryBadge(controller.doc, "Partial", counts.partial),
			this._summaryBadge(controller.doc, "Failed", counts.failed),
			this._summaryBadge(controller.doc, "Canceled", counts.canceled)
		);
		this._renderJobsList(controller, payload.jobs || []);
		this._renderJobDetail(controller, payload.selected_job || null);
	},

	_summaryBadge(doc, label, value) {
		return this._html(doc, "div", {
			className: "sr-jobs-badge sr-jobs-summary-pill",
			text: `${label}: ${value || 0}`,
		});
	},

	_renderJobsList(controller, jobs) {
		let list = controller.els.list;
		list.replaceChildren();
		if (!jobs.length) {
			list.appendChild(this._html(controller.doc, "div", {
				className: "sr-workspace-empty",
				text: "No plugin jobs have run yet.",
			}));
			return;
		}
		for (let job of jobs) {
			let isSelected =
				String(job?.project_id || "").trim() == String(controller.selectedProjectID || "").trim()
				&& String(job?.job_id || "").trim() == String(controller.selectedJobID || "").trim();
			let topMeta = `${job.project_name || "Project"}${job.project_type ? ` | ${job.project_type}` : ""}`;
			let lowerMeta = [
				job.source_title || job.source_attachment_key || job.kind,
				`progress ${job.progress_current || 0}/${job.progress_total || 0}`,
				job.wait_reason || "",
				job.updated_at ? `updated ${job.updated_at}` : "",
			].filter(Boolean).join(" | ");
			let card = this._html(controller.doc, "div", {
				className: `sr-jobs-item${isSelected ? " selected" : ""}`,
			});
			card.append(
				this._html(controller.doc, "div", {
					className: "sr-jobs-item-top",
					children: [
						this._html(controller.doc, "div", {
							className: "sr-jobs-item-title",
							text: job.title,
						}),
						this._html(controller.doc, "div", {
							className: `sr-jobs-badge ${job.status}`,
							text: job.status,
						}),
						this._html(controller.doc, "div", {
							className: "sr-jobs-badge",
							text: job.used_mode || job.requested_mode || job.kind,
						}),
					],
				}),
				this._html(controller.doc, "div", {
					className: "sr-jobs-meta",
					text: topMeta,
				}),
				this._html(controller.doc, "div", {
					className: "sr-jobs-meta",
					text: lowerMeta,
				})
			);
			card.addEventListener("pointerdown", (event) => {
				card._srPointerDown = {
					x: Number(event?.clientX || 0) || 0,
					y: Number(event?.clientY || 0) || 0,
				};
				card._srPointerDragged = false;
			});
			card.addEventListener("pointermove", (event) => {
				if (!card._srPointerDown) {
					return;
				}
				let dx = Math.abs((Number(event?.clientX || 0) || 0) - card._srPointerDown.x);
				let dy = Math.abs((Number(event?.clientY || 0) || 0) - card._srPointerDown.y);
				if (dx > 4 || dy > 4) {
					card._srPointerDragged = true;
				}
			});
			card.addEventListener("click", () => {
				let selectedText = String(controller.doc?.defaultView?.getSelection?.()?.toString?.() || "").trim();
				if (selectedText || card._srPointerDragged) {
					card._srPointerDragged = false;
					return;
				}
				controller.selectedProjectID = String(job.project_id || "").trim();
				controller.selectedJobID = String(job.job_id || "").trim();
				this._refreshController(controller).catch((error) => this._showError(error));
			});
			list.appendChild(card);
		}
	},

	async _openSelectedJobProject(controller) {
		let projectID = String(controller?.selectedProjectID || controller?.selectedJob?.project_id || "").trim();
		if (!projectID) {
			throw new Error("Select a job first.");
		}
		let current = await this._openStoredProject(projectID);
		controller.projectRef = this._projectReferenceData(current);
		await this._openWorkspaceTab(null, current);
	},

	_makeJobsActionButton(controller, label, handler) {
		let button = this._html(controller.doc, "button", {
			className: "sr-workspace-btn",
			text: label,
			attrs: { type: "button" },
		});
		button.addEventListener("click", () => {
			handler().catch((error) => this._showError(error));
		});
		return button;
	},

	_renderJobDetail(controller, job) {
		if (!job) {
			controller.els.detailTitle.textContent = "No job selected";
			controller.els.detailActions.replaceChildren();
			controller.els.detailMeta.textContent = "";
			controller.els.detailNote.hidden = true;
			controller.els.detailNote.textContent = "";
			controller.els.detailBody.textContent = "Select a job to inspect logs.";
			return;
		}
		controller.selectedJob = job;
		controller.els.detailTitle.textContent = job.title;
		controller.els.detailActions.replaceChildren(
			this._makeJobsActionButton(controller, "Open Project", async () => {
				await this._openSelectedJobProject(controller);
			})
		);
		let runAction = async (action, statusText) => {
			this._setStatus(controller, statusText);
			let response = await SystematicReviewerWorkflowJobs.controlGlobalJob(this, {
				project_id: job.project_id,
				job_id: job.job_id,
				action,
			});
			if (response?.job_id) {
				controller.selectedProjectID = String(response.project_id || job.project_id || "").trim();
				controller.selectedJobID = String(response.job_id || "").trim();
			}
			await this._refreshController(controller);
			this._setStatus(controller, "Jobs ready", "ready");
		};
		if (job.stop_available) {
			controller.els.detailActions.appendChild(this._makeJobsActionButton(controller, "Stop", async () => {
				await runAction("stop", "Stopping job...");
			}));
		}
		if (job.continue_available) {
			controller.els.detailActions.appendChild(this._makeJobsActionButton(controller, "Continue", async () => {
				await runAction("continue", "Continuing job...");
			}));
		}
		if (job.restart_available) {
			controller.els.detailActions.appendChild(this._makeJobsActionButton(controller, "Restart", async () => {
				await runAction("restart", "Restarting job...");
			}));
		}

		let metaNodes = [
			this._html(controller.doc, "div", { className: `sr-jobs-badge ${job.status}`, text: job.status }),
			this._html(controller.doc, "div", { className: "sr-jobs-badge", text: job.project_name || job.project_id || "Project" }),
			this._html(controller.doc, "div", { className: "sr-jobs-badge", text: `requested ${job.requested_mode || "-"}` }),
			this._html(controller.doc, "div", { className: "sr-jobs-badge", text: `used ${job.used_mode || "-"}` }),
			this._html(controller.doc, "div", { className: "sr-jobs-badge", text: `progress ${job.progress_current || 0}/${job.progress_total || 0}` }),
		];
		if (job.wait_reason) {
			metaNodes.push(this._html(controller.doc, "div", {
				className: "sr-jobs-badge",
				text: job.wait_reason,
			}));
		}
		controller.els.detailMeta.replaceChildren(...metaNodes);
		let isHarvestImportJob = String(job?.kind || "").trim() == "manual_harvest";
		controller.els.detailNote.hidden = !isHarvestImportJob;
		controller.els.detailNote.textContent = isHarvestImportJob
			? "Very large OpenAlex imports can occasionally stop advancing for a while. If that happens, Stop and then Continue resumes from the saved checkpoint."
			: "";

		let renderedLogs = [];
		if (job.error_message) {
			renderedLogs.push(`[error] ${job.error_message}`);
		}
		for (let log of Array.isArray(job.logs) ? job.logs : []) {
			renderedLogs.push(`[${log.created_at}] [${log.level}] ${log.message}`);
		}
		if (!renderedLogs.length) {
			renderedLogs.push("No logs recorded for this job yet.");
		}
		controller.els.detailBody.textContent = renderedLogs.join("\n");
	},
};
