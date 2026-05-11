// Browser-side LADS picker widget. Loaded once via the lads-connection
// editor HTML; exposes window.LadsPicker.attach({ ... }) for action nodes.
//
// Kinds:
//   "variable" — pick a Variable NodeId (read-value)
//   "writable" — pick a writable Variable; also auto-fills dataType field
//   "method"   — pick a Method; sets both objectId + methodId
//   "target"   — pick an FU or Function NodeId (operate)
//
// Cascading flow: connection -> device -> FU -> function -> leaf
// (For "method"/"target", the FU itself is also a valid pick at the
// "function" step, so users can drive FU-level state machines.)
(function () {
  if (window.LadsPicker) return; // idempotent — only define once

  const $ = window.jQuery || window.$;

  function urlEnc(s) { return encodeURIComponent(s); }

  // Use jQuery instead of raw fetch so Node-RED's editor-wide ajax
  // beforeSend hook attaches the admin bearer token. Without it, calls to
  // RED.auth.needsPermission-guarded routes get 401 once adminAuth is on.
  function fetchJSON(url) {
    return new Promise((resolve, reject) => {
      $.ajax({ url: url, dataType: "json", method: "GET" })
        .done(resolve)
        .fail(function (xhr) {
          let body = {};
          try { body = JSON.parse(xhr.responseText || "{}"); } catch (_) { /* ignore */ }
          const err = new Error(body.error || ("HTTP " + xhr.status));
          err.status = xhr.status;
          err.body = body;
          reject(err);
        });
    });
  }

  // Heuristic: did we get a 404 because the connection config node hasn't
  // been deployed yet? Either the route returned the explicit "not found"
  // body, or status === 404 against /devices.
  function isUndeployedError(err) {
    return err && (
      err.status === 404 ||
      (typeof err.message === "string" && err.message.includes("lads-connection not found"))
    );
  }

  function fillSelect($sel, items, opts) {
    const { valueKey, labelFn, placeholder, isJSON } = opts;
    $sel.empty();
    if (placeholder) {
      $sel.append($("<option>").val("").text(placeholder));
    }
    for (const it of items || []) {
      const v = isJSON ? JSON.stringify(it) : (valueKey ? it[valueKey] : "");
      $sel.append($("<option>").val(v).text(labelFn(it)));
    }
  }

  function attach(opts) {
    const kind = opts.kind || "variable";
    const $form = $(opts.formSelector || "form.dialog-form, .red-ui-editor-form");
    const $conn = $("#" + (opts.connectionFieldId || "node-input-connection"));
    const $nodeId = $("#" + (opts.nodeIdFieldId || "node-input-nodeId"));
    const $path = $("#" + (opts.pathFieldId || "node-input-ladsPath"));
    const $container = opts.containerSelector
      ? $(opts.containerSelector)
      : $nodeId.closest(".form-row");

    // For method picker: extra fields to populate
    const $objectIdField = opts.objectFieldId ? $("#" + opts.objectFieldId) : null;
    // For writable picker: optional dataType select to auto-fill
    const $dataType = opts.dataTypeFieldId ? $("#" + opts.dataTypeFieldId) : null;

    // Idempotent: rebuild on each attach call
    $form.find(".lads-picker-rows").remove();

    const showFunction = true;
    const leafLabel = (kind === "method") ? "Method" : "Variable";
    const leafIcon = (kind === "method") ? "fa-bolt" : "fa-hashtag";

    const $rows = $(`
      <div class="lads-picker-rows" style="border:1px dashed #d8d8d8;padding:10px;margin-bottom:8px;border-radius:4px;background:#fafafa">
        <div class="lads-pick-header" style="font-size:11px;color:#888;margin-bottom:6px;">
          <i class="fa fa-sitemap"></i> Browse the device tree (or type a NodeId below for manual entry)
        </div>
        <div class="lads-pick-info" style="display:none;padding:8px;font-size:12px;border-radius:3px;margin-bottom:4px;"></div>
        <div class="lads-pick-cascade">
          <div class="form-row" style="margin-bottom:6px">
            <label><i class="fa fa-microchip"></i> Device</label>
            <select class="lads-pick-device" style="width:70%"></select>
          </div>
          <div class="form-row" style="margin-bottom:6px">
            <label><i class="fa fa-cube"></i> Functional Unit</label>
            <select class="lads-pick-fu" style="width:70%"></select>
          </div>
          <div class="form-row lads-pick-fn-row" style="margin-bottom:6px;${kind === "target" ? "display:none" : ""}">
            <label><i class="fa fa-cog"></i> Function</label>
            <select class="lads-pick-function" style="width:70%"></select>
          </div>
          <div class="form-row lads-pick-leaf-row" style="margin-bottom:6px;${kind === "target" ? "display:none" : ""}">
            <label><i class="fa ${leafIcon}"></i> ${leafLabel}</label>
            <select class="lads-pick-leaf" style="width:70%"></select>
          </div>
          <div class="lads-pick-afo" style="display:none;margin:4px 0 6px 0;padding:6px 8px;background:#f4eef9;border-left:3px solid #9b6dd7;border-radius:2px;font-size:11px;line-height:1.45">
            <i class="fa fa-bookmark"></i> <strong>Allotrope (AFO):</strong>
            <span class="lads-pick-afo-content"></span>
          </div>
          <div style="text-align:right;font-size:11px;color:#888">
            <span class="lads-pick-path" style="float:left"></span>
            <a href="#" class="lads-pick-refresh"><i class="fa fa-refresh"></i> refresh tree</a>
          </div>
        </div>
      </div>
    `);
    $container.before($rows);

    const $cascade = $rows.find(".lads-pick-cascade");
    const $info = $rows.find(".lads-pick-info");
    const $device = $rows.find(".lads-pick-device");
    const $fu = $rows.find(".lads-pick-fu");
    const $function = $rows.find(".lads-pick-function");
    const $leaf = $rows.find(".lads-pick-leaf");
    const $pathLabel = $rows.find(".lads-pick-path");
    const $refresh = $rows.find(".lads-pick-refresh");
    const $afo = $rows.find(".lads-pick-afo");
    const $afoContent = $rows.find(".lads-pick-afo-content");

    function showInfo(html, level) {
      $cascade.hide();
      $info
        .html(html)
        .css({
          background: level === "warn" ? "#fdf3e7" : level === "error" ? "#fce8e8" : "#eef4fc",
          color: level === "warn" ? "#a05a00" : level === "error" ? "#a00" : "#33567a",
          border: "1px solid " + (level === "warn" ? "#f3c787" : level === "error" ? "#f3a0a0" : "#a8c4e0"),
        })
        .show();
    }
    function showCascade() {
      $info.hide();
      $cascade.show();
    }

    let pathState = {};
    try { pathState = JSON.parse($path.val() || "{}"); } catch (_) { pathState = {}; }
    // The connection id at attach time. Node-RED can fire a "change" event
    // on the config-typed connection field while restoring the form (or
    // when the user copy-pastes a node) — without this guard, the
    // change-handler wipes pathState before loadDevices can use it.
    var attachedConnId = $conn.val() || "";

    function connId() { return $conn.val(); }
    function apiBase() {
      // Resolve the Node-RED admin base path from RED.settings if available;
      // RED.settings.httpAdminRoot ends with "/" or is empty (root).
      let root = "";
      if (window.RED && RED.settings && typeof RED.settings.httpAdminRoot === "string") {
        root = RED.settings.httpAdminRoot;
      }
      if (root && !root.endsWith("/")) root += "/";
      return root + "lads/conn/";
    }

    function setPath(updates) {
      pathState = { ...pathState, ...updates };
      // Always remember which connection this path was picked under, so we
      // can restore on next attach without being fooled by a spurious
      // "change" event on the connection field.
      pathState.connectionId = $conn.val() || pathState.connectionId || "";
      // Compute a human-readable path string for display
      const parts = [];
      if (pathState.deviceName) parts.push(pathState.deviceName);
      if (pathState.fuName) parts.push(pathState.fuName);
      if (pathState.functionName) parts.push(pathState.functionName);
      if (pathState.leafName) parts.push(pathState.leafName);
      pathState.displayPath = parts.join(" / ");
      // Re-fetch the hidden input by id every time — captured jQuery refs
      // can become stale if Node-RED rebuilds parts of the form.
      $("#" + (opts.pathFieldId || "node-input-ladsPath"))
        .val(JSON.stringify(pathState));
      $pathLabel.text(pathState.displayPath || "");
    }

    function setNodeId(nid) {
      $nodeId.val(nid).trigger("change");
    }

    // Some servers encode the AFO IRI directly in the NodeId's `s=` part
    // (e.g. ns=6;s=http://purl.allotrope.org/ontologies/result#AFR_0001142).
    // Pull it out so the inline display can link to it.
    function extractIriFromNodeId(nidStr) {
      const m = /;s=(https?:\/\/[^;]+)/.exec(nidStr || "");
      return m ? m[1] : null;
    }
    function escapeHtml(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    let afoSeq = 0; // race-guard: ignore late responses for stale leaf picks
    async function loadAfoFor(nodeId) {
      const my = ++afoSeq;
      if (!nodeId) {
        $afo.hide();
        return;
      }
      const cid = connId();
      if (!cid) { $afo.hide(); return; }
      try {
        const list = await fetchJSON(apiBase() + cid + "/afo?node=" + urlEnc(nodeId));
        if (my !== afoSeq) return; // a newer pick fired in the meantime
        if (!list || list.length === 0) {
          $afo.hide();
          return;
        }
        const parts = list.map((e) => {
          const iri = extractIriFromNodeId(e.nodeId);
          const label = escapeHtml(e.displayName || e.browseName);
          if (iri) {
            return '<a href="' + escapeHtml(iri) + '" target="_blank" rel="noopener" title="' + escapeHtml(iri) + '">' + label + '</a>';
          }
          return '<span title="' + escapeHtml(e.nodeId) + '">' + label + '</span>';
        });
        $afoContent.html(parts.join(", "));
        $afo.show();
      } catch (e) {
        // Silent failure — AFO is best-effort context, never block the picker
        if (my === afoSeq) $afo.hide();
      }
    }

    async function loadDevices() {
      const cid = connId();
      if (!cid) {
        showInfo("Pick or create a connection above. The browser will activate once the connection is deployed.", "info");
        return;
      }
      showCascade();
      fillSelect($device, [], { labelFn: () => "", placeholder: "loading…" });
      try {
        const list = await fetchJSON(apiBase() + cid + "/devices");
        fillSelect($device, list, {
          valueKey: "nodeId",
          labelFn: d => d.displayName + " — " + d.qualifiedName,
          placeholder: "(select a device)",
        });
        if (pathState.deviceId) {
          $device.val(pathState.deviceId);
          if ($device.val()) await loadFus();
        }
      } catch (e) {
        if (isUndeployedError(e)) {
          showInfo(
            "<b>This connection isn't deployed yet.</b><br>" +
            "Click <b>Done</b> below, then <b>Deploy</b> at the top of the Node-RED toolbar. " +
            "Re-open this node afterwards and the device tree will populate.",
            "warn",
          );
        } else {
          showInfo("Browse failed: " + e.message, "error");
        }
      }
    }

    async function loadFus() {
      const cid = connId();
      const dev = $device.val();
      if (!cid || !dev) {
        fillSelect($fu, [], { labelFn: () => "", placeholder: "(pick a device)" });
        return;
      }
      try {
        const list = await fetchJSON(apiBase() + cid + "/browse?parent=" + urlEnc(dev) + "&filter=fu");
        fillSelect($fu, list, {
          valueKey: "nodeId",
          labelFn: f => f.displayName +
            (f.hasState ? " [state]" : "") +
            (f.hasProgramManager ? " [program]" : ""),
          placeholder: "(select a functional unit)",
        });
        if (pathState.fuId) {
          $fu.val(pathState.fuId);
          if ($fu.val()) await loadFunctions();
        }
      } catch (e) {
        fillSelect($fu, [], { labelFn: () => "", placeholder: "(error: " + e.message + ")" });
      }
    }

    async function loadFunctions() {
      const cid = connId();
      const fuId = $fu.val();
      if (!cid || !fuId) {
        fillSelect($function, [], { labelFn: () => "", placeholder: "(pick a functional unit)" });
        return;
      }
      try {
        const list = await fetchJSON(apiBase() + cid + "/browse?parent=" + urlEnc(fuId) + "&filter=function");
        // Always offer "(this FU)" — for method/target it makes the FU itself
        // selectable as the call target; for variable/writable it surfaces
        // FU-level variables like FunctionalUnitState/CurrentState.
        const items = [
          { nodeId: fuId, displayName: "(this FU)", qualifiedName: pathState.fuName || "FU", kind: "fu" },
          ...list,
        ];
        fillSelect($function, items, {
          valueKey: "nodeId",
          labelFn: f => {
            if (f.kind === "fu") return f.displayName;
            return f.displayName + (f.kind && f.kind !== "unknown" ? " (" + f.kind + ")" : "");
          },
          placeholder: "(select a function)",
        });
        if (kind === "target") {
          // For target picker, function selection IS the leaf
          if (pathState.functionId) $function.val(pathState.functionId);
        } else if (pathState.functionId) {
          $function.val(pathState.functionId);
          if ($function.val()) await loadLeaf();
        }
      } catch (e) {
        fillSelect($function, [], { labelFn: () => "", placeholder: "(error: " + e.message + ")" });
      }
    }

    async function loadLeaf() {
      const cid = connId();
      const parent = $function.val();
      if (!cid || !parent) {
        fillSelect($leaf, [], { labelFn: () => "", placeholder: "(pick a function)" });
        return;
      }
      try {
        let list;
        if (kind === "method") {
          list = await fetchJSON(apiBase() + cid + "/methods?target=" + urlEnc(parent));
          fillSelect($leaf, list, {
            isJSON: true,
            labelFn: m => {
              const sig = "(" + (m.inputArguments || []).map(a => a.name).join(",") +
                ")\u2192(" + (m.outputArguments || []).map(a => a.name).join(",") + ")";
              return m.name + " " + sig + " [" + m.source + "]";
            },
            placeholder: "(select a method)",
          });
          if (pathState.leafId) {
            // restore by methodId
            $leaf.find("option").each(function () {
              try {
                const m = JSON.parse($(this).val() || "{}");
                if (m.methodId === pathState.leafId) $leaf.val($(this).val());
              } catch (_) {}
            });
          }
        } else {
          const filter = (kind === "writable") ? "writable" : "variable";
          list = await fetchJSON(apiBase() + cid + "/browse?parent=" + urlEnc(parent) + "&filter=" + filter);
          fillSelect($leaf, list, {
            valueKey: "nodeId",
            labelFn: v => (v.fullName || v.displayName) +
              (v.dataType ? " : " + v.dataType : "") +
              (v.writable ? (v.readable ? " [rw]" : " [w]") : (v.readable ? "" : " [-]")),
            placeholder: kind === "writable" ? "(select a writable variable)" : "(select a variable)",
          });
          if (pathState.leafId) $leaf.val(pathState.leafId);
        }
      } catch (e) {
        fillSelect($leaf, [], { labelFn: () => "", placeholder: "(error: " + e.message + ")" });
      }
    }

    // ---- wire cascade events ----

    $conn.on("change.ladsPicker", () => {
      // Connection field changed. Only ACTUALLY reset state if the
      // connection ID actually changed — Node-RED fires synthetic change
      // events while restoring form values during dialog open / paste /
      // copy, and we don't want those to wipe the stored selection.
      const newId = $conn.val() || "";
      if (newId && newId === attachedConnId) {
        // Same connection — likely a spurious event from Node-RED's restore
        return;
      }
      if (newId && pathState.connectionId && newId === pathState.connectionId) {
        // Same connection persisted in pathState — also a no-op
        attachedConnId = newId;
        return;
      }
      attachedConnId = newId;
      pathState = {};
      $path.val("");
      $pathLabel.text("");
      $afo.hide();
      [$fu, $function, $leaf].forEach(s => fillSelect(s, [], { labelFn: () => "", placeholder: "" }));
      loadDevices();
    });

    $device.on("change", () => {
      const id = $device.val();
      const name = $device.find("option:selected").text();
      setPath({
        deviceId: id, deviceName: name,
        fuId: undefined, fuName: undefined,
        functionId: undefined, functionName: undefined,
        leafId: undefined, leafName: undefined,
      });
      loadFus();
    });

    $fu.on("change", () => {
      const id = $fu.val();
      const name = $fu.find("option:selected").text();
      setPath({
        fuId: id, fuName: name,
        functionId: undefined, functionName: undefined,
        leafId: undefined, leafName: undefined,
      });
      if (kind === "target") {
        // Target picker: if user picks "(this FU)" at the function step, use FU directly
        // For now selecting FU writes the FU NodeId immediately as the resolved target,
        // unless they pick a more specific function below
        setNodeId(id);
        setPath({ leafId: id, leafName: name });
      }
      loadFunctions();
    });

    $function.on("change", () => {
      const id = $function.val();
      const name = $function.find("option:selected").text();
      setPath({
        functionId: id, functionName: name,
        leafId: undefined, leafName: undefined,
      });
      if (kind === "target") {
        // For target picker, a function selection IS the resolved target
        if (id) {
          setNodeId(id);
          setPath({ leafId: id, leafName: name });
        }
        return;
      }
      loadLeaf();
    });

    $leaf.on("change", () => {
      const val = $leaf.val();
      const optText = $leaf.find("option:selected").text();
      if (!val) {
        $afo.hide();
        return;
      }

      let resolvedNodeId = null;
      if (kind === "method") {
        try {
          const m = JSON.parse(val);
          resolvedNodeId = m.methodId;
          setNodeId(m.methodId);
          if ($objectIdField) $objectIdField.val(m.ownerId).trigger("change");
          setPath({ leafId: m.methodId, leafName: m.name, ownerId: m.ownerId, source: m.source });
        } catch (_) { /* ignore */ }
      } else {
        resolvedNodeId = val;
        setNodeId(val);
        setPath({ leafId: val, leafName: optText });
        if (kind === "writable" && $dataType) {
          const m = /:\s*([A-Za-z0-9_]+)\s*\[/.exec(optText);
          if (m) $dataType.val(m[1]).trigger("change");
        }
      }

      // Fire-and-forget AFO lookup. The row stays hidden when there are no
      // dictionary entries on this node — most variables don't have any.
      loadAfoFor(resolvedNodeId);
    });

    $refresh.on("click", async (e) => {
      e.preventDefault();
      const cid = connId();
      if (cid) {
        try {
          // jQuery so the bearer token is attached when adminAuth is on.
          await new Promise((resolve) => {
            $.ajax({ url: apiBase() + cid + "/cache/invalidate", method: "POST" })
              .always(resolve);
          });
        } catch (_) { /* ignore */ }
      }
      await loadDevices();
    });

    // Initial load
    loadDevices();
  }

  window.LadsPicker = { attach };
})();
