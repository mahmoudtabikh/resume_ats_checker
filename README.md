# ATS Lens — Resume vs Job Match Analyzer

[![CI](https://github.com/mahmoudtabikh/resume_ats_checker/actions/workflows/ci.yml/badge.svg)](https://github.com/mahmoudtabikh/resume_ats_checker/actions/workflows/ci.yml)

A small, password-gated web app that checks how well a resume matches a job
description, the way a real ATS (applicant tracking system) would — using
Claude to actually read and reason about both documents instead of naive
keyword matching.

## What it does

1. **Upload a resume** (PDF or DOCX). Text is extracted client-side
   (pdf.js / mammoth.js) — no file ever leaves your browser except as plain
   text sent to Claude for analysis.
2. **Preview extraction**: Claude parses the raw text into structured fields
   (contact info, summary, skills, experience, education, certifications,
   etc.) via a forced tool-use call, similar to how commercial ATS parsers
   work.
3. **Run ATS analysis**: paste a job title + description, and Claude compares
   the extracted resume against it — semantic keyword matching (recognizes
   synonyms like "JS" / "JavaScript"), category scores, a requirements
   checklist, formatting review, and concrete before/after suggestions.

## Architecture

- **Frontend**: a single static file, [`ats-resume-checker.html`](ats-resume-checker.html)
  — no build step, no framework.
- **Backend**: [`server.py`](server.py), a dependency-free Python stdlib HTTP
  server that does two things:
  - Serves the static frontend.
  - Proxies `/api/claude` to the real Anthropic API, so your API key never
    reaches the browser.
  - Gates every request (except `/api/health`) behind HTTP Basic Auth.

## Local setup

Requires Python 3.9+ and an [Anthropic API key](https://console.anthropic.com/settings/keys).

```
ANTHROPIC_API_KEY=sk-ant-...         # required
ATS_USERS=alice:pass1,bob:pass2      # optional locally; required once hosted publicly
python server.py 8000
```

Then open http://127.0.0.1:8000. If `ATS_USERS` isn't set, auth is disabled
for convenience during local development (the server prints a warning).

## Deploying

See [`DEPLOY.md`](DEPLOY.md) for step-by-step instructions to host this for
free on Render, including how to add or remove users after it's live.

## Project layout

```
ats-resume-checker.html   frontend (UI + Claude calls)
server.py                 static file server + Anthropic proxy + Basic Auth
render.yaml                Render deployment blueprint
DEPLOY.md                  hosting instructions
scripts/check-tool-schemas.mjs   CI guard against invalid Claude tool schemas
.github/workflows/ci.yml   syntax check + schema check + smoke test on every push/PR
```
