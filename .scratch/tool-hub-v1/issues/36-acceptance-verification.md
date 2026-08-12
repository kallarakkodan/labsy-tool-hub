# 36 — v1.0 acceptance verification on the real server

Status: ready-for-human
Phase: P5
Blocked by: 35
Spec: PRD §14 (all), CONTEXT §9 (manual cases)

## Why

CONTEXT §9: "The large-file cases (8 GB upload, network-drop resume, 1 GbE
saturation) are manual and must be run on the real server before declaring v1."
This issue is the gate on calling v1.0 done.

## Scope

Walk every checkbox in PRD §14 and record the result. The ones that cannot be
covered by automated tests and need the real deployment:

**Throughput and resources**
- [ ] A 4 GB download saturates the 1 GbE link (≥ 900 Mbit/s)
- [ ] 20 concurrent downloads sustain aggregate line rate; the UI stays responsive
- [ ] Node CPU < ~50% of one core and RSS < 300 MB under that load
- [ ] Cancelling a download mid-stream does not leak an fd —
      `ls /proc/<pid>/fd | wc -l` returns to baseline

**Upload through the real proxy**
- [ ] An 8 GB upload does not grow NPM's container filesystem (proves
      `proxy_request_buffering off` at both hops)
- [ ] Killing the network mid-upload and restoring it resumes with no duplicate bytes
- [ ] A download through NPM starts streaming immediately, not after a delay
      (proves `proxy_buffering off`)

**Operational**
- [ ] `systemctl restart` recovers cleanly; in-flight downloads are unaffected
- [ ] The service cannot write outside `/srv/downloads` and `/var/lib/labsy-hub`
- [ ] Seed data is removable with one command and the empty state renders
- [ ] The session cookie carries `Secure`, `HttpOnly`, `SameSite=Lax`

**Design**
- [ ] Lighthouse performance on the homepage ≥ 95
- [ ] `grep -rE 'bg-gray-|text-zinc-|bg-green-|text-white|bg-black' src/` is empty
- [ ] A review pass against the PRD §5.4 anti-slop list

## Done when

- [ ] Every PRD §14 box is ticked or has a recorded, accepted deviation
- [ ] Results appended to this file under `## Comments`

## Watch out

- Run these against the **real storage medium**. PRD §12.8: spinning disk shows
  seek contention above ~8 concurrent streams, and that is a hardware finding, not
  a code bug — but it must be discovered here, not by Priya on refresh morning.
- Do not tick a box from a dev-machine result. The point of this issue is the
  real server.
