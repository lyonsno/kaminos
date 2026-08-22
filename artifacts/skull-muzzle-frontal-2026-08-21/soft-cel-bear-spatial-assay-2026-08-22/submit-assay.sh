#!/bin/zsh
set -euo pipefail

assay_dir=${0:A:h}
artifact_root=${assay_dir:h}
source_path=$artifact_root/flux-cross-source-authoring-assay-2026-08-22/cells/bear-81402/21-soft-cel-painted-resin/seed-81439/output.png
expected_source_sha=980f2ebd3beaa6d76c377cd917170928f3ea6e2a5456a275cba768708163c1c4
greenroom_bin=${GPU_GREENROOM_BIN:-/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom}
queue_dir=${GPU_GREENROOM_DIR:-/Users/noahlyons/.local/state/gpu-greenroom}
records_path=$(mktemp)
existing_map=$(mktemp)
receipt_tmp=$(mktemp)
trap 'rm -f "$records_path" "$existing_map" "$receipt_tmp"' EXIT

[[ -x "$greenroom_bin" ]] || { printf 'Missing Greenroom CLI: %s\n' "$greenroom_bin" >&2; exit 1; }
[[ -s "$source_path" ]] || { printf 'Missing selected source: %s\n' "$source_path" >&2; exit 1; }
actual_source_sha=$(shasum -a 256 "$source_path" | awk '{print $1}')
[[ "$actual_source_sha" == "$expected_source_sha" ]] || {
  printf 'Selected source digest changed: expected %s, got %s\n' "$expected_source_sha" "$actual_source_sha" >&2
  exit 1
}

find "$queue_dir" -type f -name request.json -print0 |
  xargs -0 jq -r 'select(.output_dir != null) | [.output_dir, .job_id, .submitted_at] | @tsv' > "$existing_map"
: > "$records_path"

find_request() {
  local job_id=$1
  local state candidate
  for state in pending running done failed cancelled; do
    candidate=$queue_dir/$state/$job_id/request.json
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

record_job() {
  local role=$1
  local output_dir=$2
  local job_id=$3
  local request_path=$4
  jq -cn \
    --arg role "$role" \
    --arg output_dir "$output_dir" \
    --arg job_id "$job_id" \
    --arg request_path "$request_path" \
    --argjson request "$(cat "$request_path")" \
    '{role:$role, output_dir:$output_dir, job_id:$job_id, request_path:$request_path, requested:$request, terminal_evidence:{done_receipt:("done/"+$job_id+"/receipt.json"), failed_receipt:("failed/"+$job_id+"/receipt.json")}}' >> "$records_path"
}

trellis_output=$assay_dir/trellis-control/trellis-81441
trellis_existing=$(awk -F '\t' -v output="$trellis_output" '$1 == output { print; exit }' "$existing_map")
trellis_job=$(printf '%s\n' "$trellis_existing" | awk -F '\t' '{print $2}')
if [[ -z "$trellis_job" ]]; then
  submit_output=$("$greenroom_bin" submit trellis2mlx_fast_checkpoint "$source_path" "$trellis_output" -p seed=81441 resolution=512 steps=8 target_faces=100000 texture_size=512)
  trellis_job=$(printf '%s\n' "$submit_output" | awk '/^Submitted job / {print $3; exit}')
fi
[[ -n "$trellis_job" ]] || { printf 'Could not recover TRELLIS job id\n' >&2; exit 1; }
trellis_request=$(find_request "$trellis_job") || { printf 'TRELLIS request disappeared: %s\n' "$trellis_job" >&2; exit 1; }
jq -e \
  --arg input "$source_path" \
  --arg output "$trellis_output" \
  '.job_type=="trellis2mlx_fast_checkpoint" and .input_path==$input and .output_dir==$output and .params=={seed:"81441",resolution:"512",steps:"8",target_faces:"100000",texture_size:"512"}' \
  "$trellis_request" >/dev/null || { printf 'TRELLIS request mismatch: %s\n' "$trellis_request" >&2; exit 1; }
record_job exact-source-trellis-control "$trellis_output" "$trellis_job" "$trellis_request"
printf '%s exact-source-trellis-control\n' "$trellis_job"

for prompt_id in 01-near-frontal 02-long-lens-three-quarter; do
  prompt_file=$assay_dir/prompts/$prompt_id.txt
  [[ -s "$prompt_file" ]] || { printf 'Missing prompt: %s\n' "$prompt_file" >&2; exit 1; }
  for seed in 81441 81442; do
    output_dir=$assay_dir/camera-matrix/$prompt_id/seed-$seed
    existing=$(awk -F '\t' -v output="$output_dir" '$1 == output { print; exit }' "$existing_map")
    job_id=$(printf '%s\n' "$existing" | awk -F '\t' '{print $2}')
    if [[ -z "$job_id" ]]; then
      submit_output=$("$greenroom_bin" submit mflux_flux2_edit_promptfile "$source_path" "$output_dir" -p prompt_file="$prompt_file" model=flux2-klein-9b quantize=4 height=512 width=512 steps=8 guidance=1.0 seed="$seed" mlx_cache_limit_gb=48)
      job_id=$(printf '%s\n' "$submit_output" | awk '/^Submitted job / {print $3; exit}')
    fi
    [[ -n "$job_id" ]] || { printf 'Could not recover FLUX job id for %s seed %s\n' "$prompt_id" "$seed" >&2; exit 1; }
    request_path=$(find_request "$job_id") || { printf 'FLUX request disappeared: %s\n' "$job_id" >&2; exit 1; }
    jq -e \
      --arg input "$source_path" \
      --arg output "$output_dir" \
      --arg prompt "$prompt_file" \
      --arg seed "$seed" \
      '.job_type=="mflux_flux2_edit_promptfile" and .input_path==$input and .output_dir==$output and .params=={prompt_file:$prompt,model:"flux2-klein-9b",quantize:"4",height:"512",width:"512",steps:"8",guidance:"1.0",seed:$seed,mlx_cache_limit_gb:"48"}' \
      "$request_path" >/dev/null || { printf 'FLUX request mismatch: %s\n' "$request_path" >&2; exit 1; }
    record_job "$prompt_id-seed-$seed" "$output_dir" "$job_id" "$request_path"
    printf '%s %s seed-%s\n' "$job_id" "$prompt_id" "$seed"
  done
done

jq -s \
  --slurpfile plan "$assay_dir/assay-plan.json" \
  --arg recorded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg queue_dir "$queue_dir" \
  '{schema:"kaminos.soft_cel_bear_spatial_assay.start_receipt.v1", recorded_at:$recorded_at, completion_receiver:"Handy Candyman registered endpoint", plan:$plan[0], queue_dir:$queue_dir, job_count:length, jobs:.}' \
  "$records_path" > "$receipt_tmp"

[[ $(jq -r '.job_count' "$receipt_tmp") == 5 ]] || { printf 'Expected 5 jobs\n' >&2; exit 1; }
[[ $(jq -r '[.jobs[].job_id] | unique | length' "$receipt_tmp") == 5 ]] || { printf 'Job ids are not unique\n' >&2; exit 1; }
mv "$receipt_tmp" "$assay_dir/start-receipt.json"
printf 'Recorded five unique jobs in %s\n' "$assay_dir/start-receipt.json"
