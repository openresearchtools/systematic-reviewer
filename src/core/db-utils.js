var SystematicReviewerDBUtils = {
	async _dbValue(db, sql, params = []) {
		let rows = await db.queryAsync(sql, params);
		if (!rows || !rows.length) {
			return null;
		}
		return rows[0].value;
	},

};
