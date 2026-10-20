import { findEnrollment } from "../areas/catalog/catalog.ts";
import type { CourseOutline } from "../areas/catalog/types.ts";
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
