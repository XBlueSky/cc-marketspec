export const LEGACY_FORMAT_VERSION = '1.0' as const;
/** Format 1.1 introduced the namespaced `.cc-marketspec/` layout. */
export const NAMESPACED_BASE_FORMAT_VERSION = '1.1' as const;
/** Format 1.2 adds mods, userConfig-derived configuration and the newer native
 *  component types to the manifest. A 1.1 catalog still authors a 1.2 manifest:
 *  nothing authored changed shape incompatibly. */
export const CURRENT_FORMAT_VERSION = '1.2' as const;

export type AuthoredLayout = 'legacy' | 'namespaced';
export type VersionCheck =
	| {
			ok: true;
			version: typeof LEGACY_FORMAT_VERSION | typeof NAMESPACED_BASE_FORMAT_VERSION | typeof CURRENT_FORMAT_VERSION;
			warning?: string;
	  }
	| { ok: false; error: string };

const FORMAT = /^(\d+)\.(\d+)$/;

type ParsedFormatVersion =
	| { ok: true; value: string; major: number; minor: number }
	| { ok: false; error: string };
type VersionFailure = Extract<VersionCheck, { ok: false }>;

function parseFormatVersion(value: unknown): ParsedFormatVersion {
	if (typeof value !== 'string') {
		return { ok: false, error: 'schemaVersion must be a string in MAJOR.MINOR form' };
	}
	const match = FORMAT.exec(value);
	if (!match) return { ok: false, error: `schemaVersion "${value}" must use MAJOR.MINOR form` };
	return { ok: true, value, major: Number(match[1]), minor: Number(match[2]) };
}

function rejectUnsupported({ major, minor }: { major: number; minor: number }): VersionFailure | null {
	if (major !== 1) return { ok: false, error: `unsupported format major ${major}; install a compatible cc-marketspec` };
	if (minor > 2) return { ok: false, error: `future format minor ${minor}; upgrade cc-marketspec` };
	return null;
}

export function checkFormatVersion(value: unknown, layout: AuthoredLayout): VersionCheck {
	const parsed = parseFormatVersion(value);
	if (!parsed.ok) return parsed;
	const unsupported = rejectUnsupported(parsed);
	if (unsupported) return unsupported;

	if (layout === 'legacy') {
		if (parsed.value !== LEGACY_FORMAT_VERSION) {
			return { ok: false, error: `legacy layout requires schemaVersion ${LEGACY_FORMAT_VERSION}; found ${parsed.value}` };
		}
		return { ok: true, version: LEGACY_FORMAT_VERSION, warning: 'legacy schemaVersion 1.0 is deprecated; run cc-marketspec migrate' };
	}
	if (parsed.value === NAMESPACED_BASE_FORMAT_VERSION) return { ok: true, version: NAMESPACED_BASE_FORMAT_VERSION };
	if (parsed.value === CURRENT_FORMAT_VERSION) return { ok: true, version: CURRENT_FORMAT_VERSION };
	return {
		ok: false,
		error: `namespaced layout requires schemaVersion ${NAMESPACED_BASE_FORMAT_VERSION} or ${CURRENT_FORMAT_VERSION}; found ${parsed.value}`
	};
}

export function checkManifestFormatVersion(value: unknown): VersionCheck {
	const parsed = parseFormatVersion(value);
	if (!parsed.ok) return parsed;
	const unsupported = rejectUnsupported(parsed);
	if (unsupported) return unsupported;
	if (parsed.value === LEGACY_FORMAT_VERSION) {
		return {
			ok: true,
			version: LEGACY_FORMAT_VERSION,
			warning: 'manifest schemaVersion 1.0 is deprecated; prefer a format 1.1 producer'
		};
	}
	if (parsed.value === NAMESPACED_BASE_FORMAT_VERSION) {
		return { ok: true, version: NAMESPACED_BASE_FORMAT_VERSION };
	}
	if (parsed.value === CURRENT_FORMAT_VERSION) {
		return { ok: true, version: CURRENT_FORMAT_VERSION };
	}
	return {
		ok: false,
		error: `unsupported format version ${parsed.value}; supported versions are ${LEGACY_FORMAT_VERSION}, ${NAMESPACED_BASE_FORMAT_VERSION} and ${CURRENT_FORMAT_VERSION}`
	};
}
