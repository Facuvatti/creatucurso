import { createServerFn } from "@tanstack/react-start";
import { readRequestContext } from "./request.server.ts";

export const getRequestContext = createServerFn({ method: "GET" }).handler(() =>
	readRequestContext(),
);
