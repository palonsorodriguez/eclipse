/**
 * Carga tipada del Nomenclátor estático y búsqueda difusa ligera.
 *
 * Peso: `data/municipios.json` ocupa ~620 KB (>500 KB), así que este módulo
 * NUNCA debe importarse estáticamente desde código de cliente. Los componentes
 * lo cargan con `await import("@/lib/municipios")`, de modo que el bundler lo
 * separa (JSON incluido) en un chunk propio que solo se descarga —comprimido—
 * cuando el usuario va a buscar. Ver `app/components/BuscadorMunicipio.tsx`.
 *
 * Datos: IGN/CNIG (BDLJE) vía georef-spain-municipio, CC-BY 4.0.
 * Ver `scripts/build-municipios.ts` para fuente, licencia y transformación.
 */
import datos from "../data/municipios.json";

export interface Municipio {
  nombre: string;
  provincia: string;
  lat: number;
  lon: number;
}

export const municipios: readonly Municipio[] = datos;

/** Minúsculas y sin diacríticos (NFD): "Córdoba" → "cordoba". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Índice normalizado precalculado una sola vez al cargar el módulo.
const indice = municipios.map((municipio) => ({
  municipio,
  nombreNorm: normalizar(municipio.nombre),
}));

const PESO_EXACTO = 0;
const PESO_PREFIJO = 1;
const PESO_PALABRA = 2; // prefijo de una palabra interior: "coru" → "A Coruña"
const PESO_SUBCADENA = 3;

/**
 * Búsqueda difusa ligera, sin dependencias: insensible a mayúsculas y acentos,
 * por prefijo y por subcadena. Ordena por relevancia (exacta > prefijo >
 * prefijo de palabra > subcadena), luego por longitud de nombre y alfabético.
 */
export function buscarMunicipios(consulta: string, limite = 10): Municipio[] {
  const consultaNorm = normalizar(consulta);
  if (consultaNorm.length === 0) return [];

  const candidatos: { municipio: Municipio; peso: number }[] = [];
  for (const { municipio, nombreNorm } of indice) {
    const posicion = nombreNorm.indexOf(consultaNorm);
    if (posicion === -1) continue;
    let peso: number;
    if (nombreNorm === consultaNorm) peso = PESO_EXACTO;
    else if (posicion === 0) peso = PESO_PREFIJO;
    else if (nombreNorm[posicion - 1] === " " || nombreNorm[posicion - 1] === "-")
      peso = PESO_PALABRA;
    else peso = PESO_SUBCADENA;
    candidatos.push({ municipio, peso });
  }

  candidatos.sort(
    (a, b) =>
      a.peso - b.peso ||
      a.municipio.nombre.length - b.municipio.nombre.length ||
      a.municipio.nombre.localeCompare(b.municipio.nombre, "es"),
  );

  return candidatos.slice(0, limite).map((c) => c.municipio);
}
