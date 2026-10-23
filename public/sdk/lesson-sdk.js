/*
 * Lesson SDK v1. Include it in an app embedded as a lesson.
 *
 *   LessonSDK.init({ parentOrigin: "https://academia.creatucurso.com.ar" });
 *   LessonSDK.complete({ score: 8, maxScore: 10 });
 *
 * No dependencies. See docs/lesson-sdk.md.
 */
(function (global) {
	"use strict";

	var VERSION = 1;
	var session = null;
	var parentOrigin = null;
	var configuredOrigin = null;
	var started = false;

	function post(type, payload, targetOrigin) {
		if (!global.parent || global.parent === global) return;
		global.parent.postMessage(
			{ source: "lesson-sdk", v: VERSION, type: type, payload: payload || {} },
			targetOrigin,
		);
	}

	function onMessage(event) {
		if (event.source !== global.parent) return;
		if (configuredOrigin && event.origin !== configuredOrigin) return;
		var data = event.data;
		if (!data || typeof data !== "object") return;
		if (data.source !== "course-platform" || data.v !== VERSION) return;
		if (data.type !== "lesson:init") return;
		var payload = data.payload;
		if (!payload || typeof payload.lessonToken !== "string") return;

		parentOrigin = event.origin;
		session = {
			lessonToken: payload.lessonToken,
			lessonId: String(payload.lessonId || ""),
			locale: String(payload.locale || "es"),
			theme: String(payload.theme || "light"),
		};
		post("lesson:ready", {}, parentOrigin);
		global.dispatchEvent(
			new CustomEvent("lesson:session", { detail: getSession() }),
		);
	}

	function init(options) {
		var given = options && options.parentOrigin;
		if (given) {
			try {
				configuredOrigin = new URL(given).origin;
			} catch (_) {
				throw new Error("LessonSDK: invalid parentOrigin");
			}
		}
		if (!started) {
			started = true;
			global.addEventListener("message", onMessage);
		}
		// The hello carries no secrets, so '*' is acceptable when unconfigured.
		post("lesson:hello", {}, configuredOrigin || "*");
	}

	function requireParent() {
		if (!parentOrigin) {
			throw new Error("LessonSDK: no session yet. Call init() and wait for lesson:session.");
		}
	}

	function complete(result) {
		requireParent();
		var r = result || {};
		var payload = {};
		if (typeof r.score === "number") payload.score = r.score;
		if (typeof r.maxScore === "number") payload.maxScore = r.maxScore;
		if (typeof r.passed === "boolean") payload.passed = r.passed;
		if (typeof r.timeSpentSec === "number") payload.timeSpentSec = r.timeSpentSec;
		if (r.metadata && typeof r.metadata === "object") payload.metadata = r.metadata;
		if (payload.score === undefined && payload.passed === undefined) {
			throw new Error("LessonSDK: complete() needs score and/or passed");
		}
		post("lesson:complete", payload, parentOrigin);
	}

	function progress(p) {
		requireParent();
		post("lesson:progress", { progress: Number(p) }, parentOrigin);
	}

	function getSession() {
		return session ? Object.assign({}, session) : null;
	}

	global.LessonSDK = {
		version: VERSION,
		init: init,
		complete: complete,
		progress: progress,
		getSession: getSession,
	};
})(window);
