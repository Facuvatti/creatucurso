import { Link } from "@tanstack/react-router";

export function SiteFooter({ brand }: { brand: string }) {
	return (
		<footer data-site="footer">
			<div data-site="bar">
				<p>
					© {new Date().getFullYear()} {brand}
				</p>
				<div data-actions>
					<Link to="/terminos" data-cta="ghost">
						Términos y condiciones
					</Link>
					<Link to="/privacidad" data-cta="ghost">
						Política de privacidad
					</Link>
				</div>
			</div>
		</footer>
	);
}
