export const LEGACY_FORMAT_VERSION = '1.0' as const;
export const CURRENT_FORMAT_VERSION = '1.1' as const;

export type AuthoredLayout = 'legacy' | 'namespaced';
export type VersionCheck =
	| { ok: true; version: typeof LEGACY_FORMAT_VERSION | typeof CURRENT_FORMAT_VERSION; warning?: string }
	| { ok: false; error: string };

const FORMAT = /^(\d+)\.(\d+)$/;

export function checkFormatVersion(value: unknown, layout: AuthoredLayout): VersionCheck {
	if (typeof value !== 'string') {
		return { ok: false, error: 'schemaVersion must be a string in MAJOR.MINOR form' };
	}
	const match = FORMAT.exec(value);
	if (!match) return { ok: false, error: `schemaVersion "${value}" must use MAJOR.MINOR form` };

	const major = Number(match[1]);
	const minor = Number(match[2]);
	if (major !== 1) return { ok: false, error: `unsupported format major ${major}; install a compatible cc-marketspec` };
	if (minor > 1) return { ok: false, error: `future format minor ${minor}; upgrade cc-marketspec` };

	const required = layout === 'legacy' ? LEGACY_FORMAT_VERSION : CURRENT_FORMAT_VERSION;
	if (value !== required) {
		return { ok: false, error: `${layout} layout requires schemaVersion ${required}; found ${value}` };
	}
	return layout === 'legacy'
		? { ok: true, version: LEGACY_FORMAT_VERSION, warning: 'legacy schemaVersion 1.0 is deprecated; run cc-marketspec migrate' }
		: { ok: true, version: CURRENT_FORMAT_VERSION };
}
