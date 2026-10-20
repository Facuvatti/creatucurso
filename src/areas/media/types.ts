export type VideoStatus =
	| "uploading"
	| "uploaded"
	| "encoding"
	| "ready"
	| "failed";

/** What the panel and the lesson page need to know about a lesson's video. */
export type VideoInfo = {
	id: string;
	lessonId: string;
	status: VideoStatus;
	/** Why encoding failed, in Spanish, when status is "failed". */
	error: string | null;
	durationSeconds: number | null;
	height: number | null;
	renditions: number[];
	originalBytes: number;
};
