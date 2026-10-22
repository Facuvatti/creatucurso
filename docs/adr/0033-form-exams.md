# ADR-0033: Form exams graded instantly

**Status:** Accepted
**Date:** 2026-10-22
**Deciders:** Facu

## Context

Creators need exams inside a course (single / multiple choice, true / false, short text, numeric) that are graded on the spot, with a passing score, attempt limit, time limit, shuffling and the option to show the correct answers afterwards. Required exams must block course completion, and so the certificate and the automations that depend on it.

## Decision

1. **The answer key is server-only.** `exams.option.correct` and `exams.accepted_answer` are read by one function (`loadKey` in `src/areas/exams/exams.ts`), used for grading, the staff editor and the post-submission review. Every student-facing query selects no key column, so a student gets only ids, prompts and option texts. After submitting, the key is returned only when the exam has `show_answers_after`; the same applies to past attempts.
2. **Grading happens on the server** inside the submit transaction: single / multiple / true-false compare the chosen option set with the correct set exactly; short text compares trimmed, whitespace-collapsed, case-insensitive text with the accepted values; numeric accepts a value within the answer's tolerance. The score is the percentage of points earned and `passed` is `score >= passing_score`.
3. **The time limit is enforced by the server** from `attempt.started_at`. The browser countdown is only a display. A submission later than the limit plus 10 seconds of grace is stored as `expired` (score 0, never passed); an open attempt whose time ran out and was never submitted is closed the same way the next time the student opens or starts the exam. Starting again resumes the open attempt, and a partial unique index allows one open attempt per student and exam. The shuffled question and option order is stored on the attempt (`layout`), so reloading shows the same order.
4. **Required exams gate completion.** `courseRequirementsMet` also needs `pendingRequiredExams === 0`: every published exam marked `required` has a passing attempt by the student. The check lives in `completeCourseIfDone`, called after a lesson is completed and after an exam is passed, so passing the last required exam completes the course and emits `course.completed` (certificate and automations as before). Passing emits `exam.passed` in the outbox for future automations; the worker ignores it today.
5. **Roles.** Only the owner and admins author exams and see results (`requireStaffContext`); tutors have no access to exams in this phase. Students need an active enrollment in the course of the request Host's academy. Questions are frozen once the exam has attempts, so stored answers keep their meaning; settings, publishing and deleting stay available.

## Consequences

- A student who already passed cannot retake an exam; students who did not pass can retry until `max_attempts`.
- Unsaved answers live only in the browser; reloading an open attempt keeps the order and the clock but not the typed answers.
- A required exam published after a student finished all lessons only blocks completion from then on; students already completed stay completed.
