import { Link, useRouterState } from "@tanstack/react-router";

type Props = {
	/** Name shown next to the mark: the academy on creator sites, the platform elsewhere. */
	brand: string;
	/** Creator sites show an initial instead of the platform logo. */
	academy: boolean;
	signedIn: boolean;
	loginUrl: string;
};

// Screens that are a single sign-in task: no extra "Ingresar" next to the form.
const focusedPaths = ["/login", "/recuperar", "/restablecer"];

export function SiteHeader({ brand, academy, signedIn, loginUrl }: Props) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const showLogin = !signedIn && !focusedPaths.includes(pathname);

	return (
		<header data-site="header">
			<div data-site="bar">
				<Link to="/" data-site="brand" aria-label={`${brand}: inicio`}>
					{academy ? (
						<span data-site="initial" aria-hidden="true">
							{brand.trim().charAt(0).toUpperCase()}
						</span>
					) : (
						<img src="/logo.png" alt="" width="36" height="39" />
					)}
					<span>{brand}</span>
				</Link>
				{showLogin && (
					<a href={loginUrl} data-cta="primary">
						Ingresar
					</a>
				)}
			</div>
		</header>
	);
}
