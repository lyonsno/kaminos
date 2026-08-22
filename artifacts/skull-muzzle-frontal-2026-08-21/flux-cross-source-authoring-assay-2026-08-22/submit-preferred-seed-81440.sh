#!/bin/zsh
set -euo pipefail

assay_dir=${0:A:h}
greenroom_bin=${GPU_GREENROOM_BIN:-/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom}
queue_dir=${GPU_GREENROOM_DIR:-/Users/noahlyons/.local/state/gpu-greenroom}
records_path=$(mktemp)
existing_map=$(mktemp)
receipt_tmp=$(mktemp)
trap 'rm -f "$records_path" "$existing_map" "$receipt_tmp"' EXIT

find "$queue_dir" -type f -name request.json -print0 |
  xargs -0 jq -r \
    'select(.output_dir != null) | [.output_dir, .job_id, .submitted_at, input_filename] | @tsv' \
    > "$existing_map"
: > "$records_path"

sources=(canonical-horned bear-81402 lioness-81406 lynx-81408)
prompts=(21-soft-cel-painted-resin 06-feature-animation-sculptural)

for source_id in $sources; do
  source_path=$assay_dir/sources/$source_id.png
  [[ -s "$source_path" ]] || { printf 'Missing source: %s\n' "$source_path" >&2; exit 1; }

  for prompt_id in $prompts; do
    prompt_file=$assay_dir/prompts/$prompt_id.txt
    output_dir=$assay_dir/cells/$source_id/$prompt_id/seed-81440
    existing_record=$(awk -F '\t' -v output="$output_dir" '$1 == output { print; exit }' "$existing_map")
    job_id=$(printf '%s\n' "$existing_record" | awk -F '\t' '{ print $2 }')

    if [[ -z "$job_id" ]]; then
      submit_output=$(
        "$greenroom_bin" submit \
          mflux_flux2_edit_promptfile \
          "$source_path" \
          "$output_dir" \
          -p \
          prompt_file="$prompt_file" \
          model=flux2-klein-9b \
          quantize=4 \
          height=512 \
          width=512 \
          steps=8 \
          guidance=1.0 \
          seed=81440 \
          mlx_cache_limit_gb=48
      )
      job_id=$(printf '%s\n' "$submit_output" | awk '/^Submitted job / { print $3; exit }')
      [[ -n "$job_id" ]] || {
        printf 'Could not recover job id for %s\n%s\n' "$output_dir" "$submit_output" >&2
        exit 1
      }
      request_path=
      for state in pending running done failed cancelled; do
        candidate=$queue_dir/$state/$job_id/request.json
        if [[ -f "$candidate" ]]; then
          request_path=$candidate
          break
        fi
      done
      [[ -n "$request_path" ]] || {
        printf 'Request disappeared for job %s (%s)\n' "$job_id" "$output_dir" >&2
        exit 1
      }
      submitted_at=$(jq -r '.submitted_at' "$request_path")
      printf '%s\t%s\t%s\t%s\n' "$output_dir" "$job_id" "$submitted_at" "$request_path" >> "$existing_map"
    else
      submitted_at=$(printf '%s\n' "$existing_record" | awk -F '\t' '{ print $3 }')
      request_path=$(printf '%s\n' "$existing_record" | awk -F '\t' '{ print $4 }')
    fi

    jq -cn \
      --arg source_id "$source_id" \
      --arg source_path "$source_path" \
      --arg prompt_id "$prompt_id" \
      --arg prompt_file "$prompt_file" \
      --arg output_dir "$output_dir" \
      --arg job_id "$job_id" \
      --argjson submitted_at "$submitted_at" \
      --arg request_path "$request_path" \
      '{source_id: $source_id, source_path: $source_path, prompt_id: $prompt_id, prompt_file: $prompt_file, seed: 81440, output_dir: $output_dir, job_id: $job_id, submitted_at: $submitted_at, request_path: $request_path}' \
      >> "$records_path"
    printf '%s %s %s\n' "$job_id" "$source_id" "$prompt_id"
  done
done

jq -s \
  --slurpfile plan "$assay_dir/matrix-plan.json" \
  --arg recorded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    schema: "kaminos.handy_candyman.flux_cross_source_authoring_assay.preferred_seed_start_receipt.v1",
    recorded_at: $recorded_at,
    campaign_question: "Do the operator-preferred soft-cel and feature-animation transformations repeat directionally at a second fixed generation seed?",
    requested_route: ($plan[0].requested_route | .seed = 81440),
    comparison_contract: "Hold source bytes, source-neutral preservation clause, exact style clause, requested route, and raster coordinates fixed. Vary only generation seed from 81439 to 81440.",
    claim_ceiling: "Two-seed directional stability of the preferred transformations; no universal prompt-behavior or spatial-cast claim.",
    job_count: length,
    jobs: .
  }' \
  "$records_path" > "$receipt_tmp"

[[ $(jq -r '.job_count' "$receipt_tmp") == 8 ]] || {
  printf 'Expected 8 jobs, found %s\n' "$(jq -r '.job_count' "$receipt_tmp")" >&2
  exit 1
}
[[ $(jq -r '[.jobs[].job_id] | unique | length' "$receipt_tmp") == 8 ]] || {
  printf 'Job IDs are not unique\n' >&2
  exit 1
}

mv "$receipt_tmp" "$assay_dir/preferred-seed-81440-start-receipt.json"
printf 'Recorded 8 unique jobs in %s\n' "$assay_dir/preferred-seed-81440-start-receipt.json"
