# Deploying ATS Lens (password-gated, for you + your sister)

This app is a single Python stdlib server (`server.py`) with no dependencies, so
hosting is cheap and simple. These steps use [Render.com](https://render.com)'s
free tier.

## 1. Push this project to GitHub

```
git init
git add .
git commit -m "Initial commit"
```

Then create a new **private** GitHub repo (recommended, since the code itself
is not sensitive but there's no reason to make it public) and push:

```
git remote add origin https://github.com/<you>/<repo-name>.git
git branch -M main
git push -u origin main
```

## 2. Create the Render web service

1. Sign in at https://dashboard.render.com (GitHub login is easiest).
2. Click **New** → **Blueprint**, and pick the repo you just pushed.
   Render will detect `render.yaml` in this folder automatically.
3. Render will ask you to fill in the secret environment variables declared
   in `render.yaml` (intentionally left blank in the file so they never end
   up in git):
   - `ANTHROPIC_API_KEY` — your Anthropic API key
   - `ATS_USERS` — one or more `username:password` pairs, comma-separated,
     e.g. `mahmoud:correcthorse123,sister:anotherpassword456`. Each person
     gets their own login instead of sharing one password.
4. Click **Apply** / **Deploy**.

Render will build and start the service. The first deploy takes a minute or two.

## 3. Verify it's locked down

Visit the `.onrender.com` URL Render gives you. Your browser should
immediately pop up a native username/password prompt (HTTP Basic Auth) before
anything loads. Wrong or missing credentials → blank 401 page. Correct
credentials → the app loads normally.

Share the URL + her own username + password with your sister directly (e.g.
in a message), not anywhere public.

## Adding or removing users

Go to the Render dashboard → your service → **Environment** → edit the
`ATS_USERS` value → **Save Changes**. Render redeploys automatically
(takes under a minute) with the new list.

- **Add someone**: append `,newname:theirpassword` to the existing value.
- **Remove someone**: delete their `name:password` pair from the value.
- No code changes or redeploy-from-git needed — it's just an env var.

For local testing, set the same env var before running `python server.py`:
`ATS_USERS="mahmoud:pass1,sister:pass2"`.

## Notes

- **Free tier cold starts**: Render's free web services spin down after
  ~15 minutes of no traffic and take ~30-50 seconds to wake back up on the
  next request. Fine for occasional personal use. If that's annoying, switch
  the `plan` in `render.yaml` from `free` to `starter` (~$7/month) for an
  always-on instance.
- **Rotate the old key**: this project used to keep a live Anthropic API key
  in a plaintext `config.js` file that was served to anyone who requested it.
  That file has been deleted, but if you haven't already, rotate that old key
  at https://console.anthropic.com/settings/keys — treat it as compromised.
- **Costs**: each Preview click and each Analyze click makes real Claude API
  calls (Analyze makes two: one extraction call, one JD-matching call).
  Personal, occasional use by two people costs a few cents to a few dollars a
  month depending on usage — check https://console.anthropic.com/settings/billing.
