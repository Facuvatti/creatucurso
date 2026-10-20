import { findEnrollment } from "../areas/catalog/catalog.ts";
import type { CourseOutline } from "../areas/catalog/types.ts";
import { findRoles } from "../areas/identity/members.ts";
import { can } from "../areas/identity/permissions.ts";
import type { RequestContext } from "./request.server.ts";

export type CourseAccess = {
	signedIn: boolean;
	canManage: boolean;
	isInstructor: boolean;
	enrolled: boolean;
	canStudy: boolean;
};

export async function accessFor(
	context: RequestContext,
	course: CourseOutline,
): Promise<CourseAccess> {
	const { user, roles } = context;
	const canManage = can(roles, { course: ["update"] });
	const isInstructor =
		!!user && roles.includes("tutor") && course.instructorIds.includes(user.id);
	const enrolled = user
		? (await findEnrollment(course.id, user.id)) !== null
		: false;
	return {
		signedIn: !!user,
		canManage,
		isInstructor,
		enrolled,
		canStudy: canManage || isInstructor || enrolled,
	};
}

// ------------------------------------------------------------------- guards
// Plain functions that throw when the check fails. Callers pass the tenant that
// came from the request Host, so a person enrolled in academy A has no access
// in academy B: the course lookup is by tenant and these checks use that course.

const DENIED = "No tenés acceso a esto.";

/** The person has `role` in the academy. */
export async function assertMembership(
	user: { id: string },
	organizationId: string,
	role: string,
): Promise<void> {
	const roles = await findRoles(organizationId, user.id);
	if (!roles.includes(role)) throw new Error(DENIED);
}

/** The person is a tutor and is assigned to this course. */
export function assertTutorOfCourse(
	user: { id: string },
	roles: readonly string[],
	course: CourseOutline,
): void {
	if (!roles.includes("tutor") || !course.instructorIds.includes(user.id)) {
		throw new Error(DENIED);
	}
}

/** The person is enrolled in this course. */
export async function assertEnrollment(
	user: { id: string },
	course: CourseOutline,
): Promise<void> {
	if ((await findEnrollment(course.id, user.id)) === null) {
		throw new Error(DENIED);
	}
}
