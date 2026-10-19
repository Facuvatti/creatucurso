import { type OrganizationRole, roles } from "./permissions.ts";

type Request = Parameters<(typeof roles)["owner"]["authorize"]>[0];

/** True when at least one of the member's roles grants every requested permission. */
export function can(memberRoles: readonly string[], request: Request): boolean {
	return memberRoles.some((name) => {
		const role = roles[name as OrganizationRole];
		return role?.authorize(request).success === true;
	});
}
