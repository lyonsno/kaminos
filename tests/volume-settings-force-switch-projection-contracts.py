# kaminos-test: python
"""The server's preset projection moves retired force switches onto their sliders.

Operator 2026-10-22: the hidden procedural-force switches were retired;
Microdetail and Shred are their own switches and Fine breakup became Swirl
jostle. A saved basin whose switch was off must load with that slider at 0,
or it gains a force it never had (the common saved shape is Shred 5 with its
switch off). The browser migration does this too, but the server projects the
basin first, so the browser never sees the switch.
"""

import json
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import serve

schema = json.loads((ROOT / "volume-settings-preset-schema-v2.json").read_text())
retired = {descriptor["key"]: descriptor for descriptor in schema["retiredControls"]}


def route_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def default_value(control):
    if "additiveDefault" in control:
        return control["additiveDefault"]
    if control["type"] == "checkbox":
        return False
    if control["tagName"] == "SELECT":
        return (control.get("allowedValues") or ["fixture"])[0]
    if control["type"] in ("text", "url", "color"):
        return "#000000" if control["type"] == "color" else ""
    return 0


def payload(switches, sliders, omit=()):
    dom = {}
    route = [(schema["activationParam"]["key"], schema["activationParam"]["value"])]
    for control in schema["controls"]:
        if control["key"] in omit:
            continue
        value = sliders.get(control["key"], default_value(control))
        dom[control["key"]] = {"id": control["key"], "param": control["param"], "tagName": control["tagName"], "type": control["type"], "value": value}
        route.append((control["param"], route_value(value)))
    for key, value in switches.items():
        descriptor = retired[key]
        dom[key] = {"id": key, "param": descriptor["param"], "tagName": descriptor["tagName"], "type": descriptor["type"], "value": value}
        route.append((descriptor["param"], route_value(value)))
    renderer = {c["key"]: {"id": c["key"], "param": c["param"], "tagName": c["tagName"], "type": c["type"], "value": c.get("additiveDefault", 0)} for c in schema["rendererControls"]}
    presentation = {c["key"]: {"id": c["key"], "param": c["param"], "tagName": c["tagName"], "type": c["type"], "value": c.get("additiveDefault")} for c in schema["presentationControls"]}
    for c in [*schema["rendererControls"], *schema["presentationControls"]]:
        route.append((c["param"], route_value(c.get("additiveDefault", 0))))
    for param in schema["routeExtraParams"]:
        route.append((param, "fixture"))
    return {
        "identity": serve.VOLUME_SETTINGS_PRESET_IDENTITY, "kind": "settings-preset", "schemaIdentity": schema["identity"],
        "savedAt": "2026-10-01T00:00:00Z", "route": "http://kaminos.invalid/?" + urlencode(route),
        "domControls": dom, "controlCount": len(dom),
        "rendererControls": renderer, "rendererControlCount": len(renderer),
        "presentationControls": presentation, "presentationControlCount": len(presentation),
        "stateExclusions": {field: True for field in schema["excludedStateFields"]},
    }


def project(document):
    normalized, receipt = serve.normalize_volume_settings_preset_payload(document, schema, tolerate_foreign_controls=True)
    route = dict(parse_qsl(urlparse(normalized["route"]).query))
    return normalized, receipt, route


def value(normalized, key):
    return float(normalized["domControls"][key]["value"])


all_on = {"volume-procedural-detail-forces": True, "volume-force-micro-carrier": True, "volume-force-interface-shred": True, "volume-force-fine-breakup": True}
sliders = {"volume-microdetail": 0.9, "volume-interface-shred": 5, "volume-swirl-jostle": 1}

normalized, receipt, route = project(payload({**all_on, "volume-force-interface-shred": False}, sliders))
assert value(normalized, "volume-interface-shred") == 0, "a shred switch that was off sets Shred to 0"
assert route["volume_interface_shred"] == "0", "the applied route agrees"
assert value(normalized, "volume-microdetail") == 0.9, "a switch that was on leaves its slider alone"
assert receipt["forceSwitchTransfers"] == ["volume-interface-shred"], receipt.get("forceSwitchTransfers")

normalized, receipt, route = project(payload({**all_on, "volume-force-fine-breakup": False}, sliders, omit={"volume-swirl-jostle"}))
assert value(normalized, "volume-swirl-jostle") == 0, "a basin saved before Swirl jostle, with fine breakup off, gains it at 0"
assert route["volume_swirl_jostle"] == "0"

normalized, receipt, route = project(payload({**all_on, "volume-procedural-detail-forces": False}, sliders))
assert [value(normalized, key) for key in ("volume-microdetail", "volume-interface-shred", "volume-swirl-jostle")] == [0, 0, 0], "the master switch off turned all three off"

normalized, receipt, route = project(payload(all_on, sliders))
assert [value(normalized, key) for key in ("volume-microdetail", "volume-interface-shred", "volume-swirl-jostle")] == [0.9, 5, 1], "all switches on: sliders unchanged"
assert receipt["forceSwitchTransfers"] == []
print("server force-switch projection contracts passed")
