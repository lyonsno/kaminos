#!/bin/zsh
set -euo pipefail

atlas_dir=${0:A:h}
source_path=${atlas_dir:h}/flux-81408/output.png
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

for seed in 81436 81437 81438 81439; do
  if (( seed <= 81437 )); then
    wave=wave-1
  else
    wave=wave-2
  fi

  for prompt_file in "$atlas_dir"/prompts/*.txt; do
    prompt_id=${prompt_file:t:r}
    output_dir=$atlas_dir/$wave/seed-$seed/$prompt_id
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
          seed="$seed" \
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
      --arg wave "$wave" \
      --argjson seed "$seed" \
      --arg prompt_id "$prompt_id" \
      --arg prompt_file "$prompt_file" \
      --arg output_dir "$output_dir" \
      --arg job_id "$job_id" \
      --argjson submitted_at "$submitted_at" \
      --arg request_path "$request_path" \
      '{wave: $wave, seed: $seed, prompt_id: $prompt_id, prompt_file: $prompt_file, output_dir: $output_dir, job_id: $job_id, submitted_at: $submitted_at, request_path: $request_path}' \
      >> "$records_path"
    printf '%s %s %s\n' "$job_id" "$seed" "$prompt_id"
  done
done

jq -s \
  --slurpfile plan "$atlas_dir/matrix-plan.json" \
  --arg recorded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    schema: "kaminos.handy_candyman.flux_style_construction_atlas.start_receipt.v1",
    recorded_at: $recorded_at,
    source: $plan[0].source,
    requested_route: $plan[0].requested_route,
    completion_delivery: $plan[0].completion_delivery,
    claim_ceiling: $plan[0].claim_ceiling,
    job_count: length,
    jobs: .
  }' \
  "$records_path" > "$receipt_tmp"

[[ $(jq -r '.job_count' "$receipt_tmp") == 96 ]] || {
  printf 'Expected 96 jobs, found %s\n' "$(jq -r '.job_count' "$receipt_tmp")" >&2
  exit 1
}
[[ $(jq -r '[.jobs[].job_id] | unique | length' "$receipt_tmp") == 96 ]] || {
  printf 'Job IDs are not unique\n' >&2
  exit 1
}

mv "$receipt_tmp" "$atlas_dir/start-receipt.json"
printf 'Recorded 96 unique jobs in %s\n' "$atlas_dir/start-receipt.json"
