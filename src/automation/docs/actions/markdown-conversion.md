# Action: markdown_conversion

Queue markdown conversion for retrieved PDFs using the project's configured PDF mode.

Rules:

- Conversion should begin while full-text retrieval is still discovering PDFs.
- Retrieval-status checks may automatically queue newly detected PDFs for conversion.
- Use the project's configured conversion mode instead of inventing a new one.
- Conversion is for retrieved PDFs only; do not try to convert records that still have no PDF attachment.
- Report the number of queued or newly detected conversion candidates rather than claiming conversion is already complete.
- Use the conversion-status helper when you need to know whether queued jobs are still running or have already finished.
