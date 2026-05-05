var SystematicReviewerWorkflowJobs = (() => {
	function optionalString(value = "") {
		return String(value || "").trim();
	}

	function normalizeLimit(value, fallback = 25, max = 500) {
		let parsed = Number(value || 0) || 0;
		if (parsed <= 0) {
			return fallback;
		}
		return Math.max(1, Math.min(max, Math.round(parsed)));
	}

	async function startJob(reviewer, current, options = {}) {
		if (!reviewer?._insertWorkflowJobRecord) {
			throw new Error("Workflow jobs runtime is unavailable.");
		}
		let job = await reviewer._insertWorkflowJobRecord(current, Object.assign({}, options, {
			status: "running",
		}));
		if (reviewer?._appendJobLog && current?.context && job?.job_id) {
			await reviewer._appendJobLog(current.context, job.job_id, "info", `Started ${job.title}`);
		}
		await reviewer?._refreshAllControllers?.();
		return job;
	}

	async function log(reviewer, current, jobIDValue, level, message, options = {}) {
		if (!reviewer?._appendJobLog || !current?.context || !jobIDValue) {
			return;
		}
		await reviewer._appendJobLog(current.context, jobIDValue, level || "info", String(message || "").trim());
		if (options.refresh !== false) {
			await reviewer?._refreshAllControllers?.();
		}
	}

	async function progress(reviewer, current, jobIDValue, currentValue, totalValue, message = "", options = {}) {
		if (!reviewer?._updateJobProgress || !current?.context || !jobIDValue) {
			return;
		}
		await reviewer._updateJobProgress(
			current.context,
			jobIDValue,
			Number(currentValue || 0) || 0,
			Number(totalValue || 0) || 0,
			String(message || ""),
			options || {}
		);
	}

	async function succeed(reviewer, current, jobIDValue, options = {}) {
		if (!reviewer?._markJobSucceeded) {
			throw new Error("Workflow jobs runtime is unavailable.");
		}
		await reviewer._markJobSucceeded(current, jobIDValue, options || {});
	}

	async function partial(reviewer, current, jobIDValue, options = {}) {
		if (!reviewer?._markJobPartial) {
			throw new Error("Workflow jobs runtime is unavailable.");
		}
		await reviewer._markJobPartial(current, jobIDValue, options || {});
	}

	async function fail(reviewer, current, jobIDValue, error, options = {}) {
		if (!reviewer?._markJobFailed) {
			throw new Error("Workflow jobs runtime is unavailable.");
		}
		await reviewer._markJobFailed(current, jobIDValue, error, options || {});
	}

	async function cancel(reviewer, current, jobIDValue, options = {}) {
		if (!reviewer?._markJobCanceled) {
			throw new Error("Workflow jobs runtime is unavailable.");
		}
		await reviewer._markJobCanceled(current, jobIDValue, options || {});
	}

	async function listJobs(reviewer, current, options = {}) {
		if (!reviewer || !current?.context) {
			throw new Error("A current workflow project is required.");
		}
		let limit = normalizeLimit(options.limit, 25, 200);
		let rows = await reviewer._listJobs(current.context, limit);
		if (!reviewer?._decorateJobRecord) {
			return rows;
		}
		let project = {
			project_id: current.context.projectID,
			collection_name: current.collection?.name || current.context.collectionName || "",
			project_type: current.projectType || current.context.projectType || "",
		};
		return rows.map((row) => reviewer._decorateJobRecord(row, project));
	}

	async function loadJob(reviewer, current, options = {}) {
		if (!reviewer || !current?.context) {
			throw new Error("A current workflow project is required.");
		}
		let requested = optionalString(options.job_id || options.jobID);
		let jobs = await listJobs(reviewer, current, {
			limit: options.job_limit || options.limit || 25,
		});
		let selected = requested || jobs[0]?.job_id || "";
		if (!selected) {
			return {
				ok: true,
				selected_job_id: "",
				job: null,
			};
		}
		let job = reviewer?._readJobRecord
			? await reviewer._readJobRecord(current.context, selected)
			: (jobs.find((entry) => entry.job_id == selected) || null);
		if (!job) {
			return {
				ok: true,
				selected_job_id: "",
				job: null,
			};
		}
		let logs = await reviewer._jobLogs(
			current.context,
			selected,
			normalizeLimit(options.log_limit || options.logLimit, 120, 500)
		);
		let logCount = reviewer?._jobLogCount
			? await reviewer._jobLogCount(current.context, selected)
			: logs.length;
		let metadata = reviewer?._parseJobMetadata ? reviewer._parseJobMetadata(job || {}) : {};
		return {
			ok: true,
			selected_job_id: selected,
			job: Object.assign({}, reviewer?._cleanJobRecord ? reviewer._cleanJobRecord(job || {}) : (job || {}), {
				metadata,
				log_count: logCount,
				logs,
			}),
		};
	}

	async function listGlobalJobs(reviewer, options = {}) {
		if (!reviewer?._listGlobalJobs) {
			throw new Error("Workflow jobs runtime is unavailable.");
		}
		return await reviewer._listGlobalJobs(options || {});
	}

	async function loadGlobalJob(reviewer, options = {}) {
		if (!reviewer?._loadGlobalJob) {
			throw new Error("Workflow jobs runtime is unavailable.");
		}
		return await reviewer._loadGlobalJob(options || {});
	}

	async function controlGlobalJob(reviewer, options = {}) {
		if (!reviewer?._controlGlobalJob) {
			throw new Error("Workflow jobs runtime is unavailable.");
		}
		return await reviewer._controlGlobalJob(options || {});
	}

	return {
		startJob,
		log,
		progress,
		succeed,
		partial,
		fail,
		cancel,
		listJobs,
		loadJob,
		listGlobalJobs,
		loadGlobalJob,
		controlGlobalJob,
	};
})();
