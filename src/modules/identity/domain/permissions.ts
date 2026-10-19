import { createAccessControl } from "better-auth/plugins/access";
import {
	adminAc,
	defaultStatements,
	ownerAc,
} from "better-auth/plugins/organization/access";

export const statement = {
	...defaultStatements,
	course: ["read", "create", "update", "publish", "delete"],
	review: ["create", "moderate"],
	comment: ["create", "reply", "moderate"],
	exam: ["manage", "view-results", "attempt"],
	certificate: ["read", "configure", "revoke"],
	automation: ["manage"],
	billing: ["manage"],
	chat: ["participate"],
} as const;

export const ac = createAccessControl(statement);

const staffPermissions = {
	course: ["read", "create", "update", "publish", "delete"],
	review: ["moderate"],
	comment: ["create", "reply", "moderate"],
	exam: ["manage", "view-results"],
	certificate: ["read", "configure", "revoke"],
	automation: ["manage"],
	chat: ["participate"],
} as const;

export const roles = {
	owner: ac.newRole({
		...ownerAc.statements,
		...staffPermissions,
		billing: ["manage"],
	}),
	admin: ac.newRole({ ...adminAc.statements, ...staffPermissions }),
	tutor: ac.newRole({
		course: ["read"],
		comment: ["create", "reply", "moderate"],
		exam: ["view-results"],
		chat: ["participate"],
	}),
	student: ac.newRole({
		course: ["read"],
		review: ["create"],
		comment: ["create", "reply"],
		exam: ["attempt"],
		certificate: ["read"],
		chat: ["participate"],
	}),
};

export type OrganizationRole = keyof typeof roles;
