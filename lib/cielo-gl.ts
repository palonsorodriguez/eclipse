/**
 * cielo-gl — Renderizador WebGL de la Vista Cielo hiperrealista (issue #39).
 *
 * ## Por qué WebGL crudo y no three.js
 *
 * La escena son exactamente dos draw calls: un quad a pantalla completa
 * cuyo fragment shader calcula TODO el ambiente (dispersión atmosférica,
 * anillo crepuscular, sombra de la umbra, terreno con parallax, Sol,
 * halo, corona, cromosfera, Luna oclusora, anillo de diamante y perlas) y
 * un pase de GL_POINTS para las estrellas. No hay grafo de escena, ni
 * mallas, ni cámara 3D: three.js añadiría ~150 KB gzip para administrar
 * dos triángulos. El "bloom" del Sol es un kernel de halo analítico en el
 * propio shader (más barato en móvil que un postproceso multi-pass y
 * suficiente para discos y destellos puntuales).
 *
 * ## Arquitectura
 *
 * Toda la lógica pura (proyección, brillo, acoplamientos, catálogo) vive
 * en `cielo-render`, `cielo-camara`, `cielo-luz` y `cielo-estrellas`;
 * este módulo solo la sube como uniformes y replica en GLSL las fórmulas
 * documentadas allí (perfil de terreno, alfa de aparición de estrellas).
 *
 * La corona es la textura real derivada de la fotografía HDR del eclipse
 * de 2024 (ver `scripts/generar-corona.mjs`), modulada en el shader:
 * rotación lenta, ruido sutil animado, caída radial extra (~1/r^2.5 en
 * total), tinte de extinción atmosférica y gradiente vertical con el Sol
 * bajo. Hasta que la textura carga (o si falla) hay una corona analítica
 * de respaldo: nunca un frame sin corona en la Totalidad.
 */

import type { PosicionesSolLuna } from "./eclipse-engine";
import {
  escenaSolLuna,
  pxPorGrado,
  yHorizonte,
  type ConfigEscena,
} from "./cielo-render";
import {
  anguloContacto,
  intensidadAnilloDiamante,
  intensidadPerlas,
  sombraLateral,
} from "./cielo-extras";
import {
  ARMONICOS_ECLIPSE,
  NUM_ARMONICOS_LIMBO,
  perlasDesdeLimbo,
  RUGOSIDAD_RENDER,
} from "./cielo-limbo";
import {
  alfaCorona,
  factorLuna,
  gradienteExtincion,
  intensidadAnillo360,
  intensidadCromosfera,
  luzAmbiente,
  tinteExtincion,
} from "./cielo-luz";
import type { CuerpoDomo } from "./cielo-estrellas";

/**
 * Fracción del medio lado de la textura de corona a la que está el limbo
 * lunar (medida en `scripts/generar-corona.mjs`: RADIO_LUNA/MEDIO_LADO).
 */
export const FRACCION_LIMBO_CORONA = 0.447;

/** Ruta pública de la textura de corona versionada. */
export const RUTA_TEXTURA_CORONA = "/texturas/corona.png";

/** Acimut (grados) por donde llega la umbra (ONO; ver cielo-extras). */
const ACIMUT_UMBRA_LLEGA = 295;
/** Acimut (grados) por donde se retira la oscuridad tras C3 (ESE). */
const ACIMUT_UMBRA_SE_VA = 115;

/** Un fotograma completo para el renderizador. */
export interface FotogramaCieloGL {
  /** Encuadre a resolución del buffer (de `configVistaInmersiva`). */
  cfg: ConfigEscena;
  posiciones: PosicionesSolLuna;
  /** Brillo de escena [0,1] (de `brilloEscena`). */
  brillo: number;
  obscuracion: number;
  enTotalidad: boolean;
  tMs: number;
  c2Ms: number | null;
  c3Ms: number | null;
  /** Reloj de pared en segundos, para las animaciones sutiles del shader. */
  tAnimS: number;
  /** Cuerpos del domo (cacheados por segundo por el llamante). */
  cuerpos: CuerpoDomo[];
  /** `true` = vista con gafas de eclipse (filtro solar: solo la fotosfera). */
  modoGafas: boolean;
}

export interface RendererCielo {
  /** Redimensiona el buffer de render (px reales, ya con dpr × escala). */
  redimensionar(ancho: number, alto: number): void;
  /** Pinta un fotograma completo. */
  dibujar(f: FotogramaCieloGL): void;
  /** Libera los recursos GL. */
  destruir(): void;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERT_CIELO = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/**
 * El shader del cielo. Espacios de trabajo:
 * - (alt, az) en grados para todo lo atmosférico y el terreno (proyección
 *   cilíndrica inversa del píxel).
 * - px del buffer para los discos (Sol/Luna con zoom) y sus efectos.
 */
const FRAG_CIELO = `
precision highp float;

uniform vec2  uRes;          // resolución del buffer (px)
uniform float uPpg;          // px por grado
uniform float uYHor;         // y del horizonte (px desde arriba)
uniform float uAzCentro;     // acimut del centro (grados)
uniform vec2  uSolAltAz;     // (alt, az) reales del Sol, sin zoom
uniform vec2  uSolPx;        // centro del disco solar (px, con zoom)
uniform vec2  uLunaPx;       // centro del disco lunar (px, con zoom)
uniform float uRSol;         // radio del disco solar (px)
uniform float uRLuna;        // radio del disco lunar (px)
uniform float uBrillo;       // brillo de escena [0,1]
uniform float uFotosfera;    // fracción de fotosfera visible (1-obscuración)
uniform float uFactorLuna;   // luminancia Luna/cielo (acoplamiento)
uniform float uAnillo360;    // anillo crepuscular [0,1]
uniform float uAlfaCorona;   // fundido de la corona [0,1]
uniform float uCromo;        // cromosfera [0,1]
uniform float uAngContacto;  // ángulo del punto de contacto (rad, y abajo)
uniform float uDiamante;     // anillo de diamante [0,1]
uniform float uPerlasInt;    // perlas de Baily [0,1]
uniform vec3  uPerlas[6];    // (ángulo absoluto rad, profundidad, 0)
uniform float uNumPerlas;
uniform vec3  uLimbo[8];     // armónicos del limbo lunar (frec, amp, fase)
uniform float uRugosidad;    // amplitud del relieve (fracción del radio)
uniform float uGafas;        // 1 = vista con gafas de eclipse
uniform float uSombraInt;    // sombra de la umbra [0,1]
uniform float uAzSombra;     // acimut del que llega/al que se va (grados)
uniform vec3  uTinte;        // tinte de extinción (Sol bajo)
uniform float uGradExt;      // gradiente vertical de extinción [0,1]
uniform vec3  uLuzAmb;       // luz ambiente del terreno
uniform float uTiempo;       // s de reloj de pared (animaciones)
uniform sampler2D uCorona;
uniform float uCoronaLista;  // 1 si la textura está cargada
uniform float uEscCorona;    // medio lado del quad de textura (px)

const float PI = 3.14159265358979;

// --- utilidades ------------------------------------------------------------

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Coseno del ángulo entre dos direcciones alt-az (grados).
float cosAngulo(vec2 aA, vec2 aB) {
  float a1 = radians(aA.x); float a2 = radians(aB.x);
  return sin(a1) * sin(a2) + cos(a1) * cos(a2) * cos(radians(aA.y - aB.y));
}

// --- dispersión atmosférica (Rayleigh + Mie de un rebote) ------------------
// Modelo compacto: transmitancias exp(-beta·m) sobre masa de aire
// 1/(sin h + c) para la vista y para el Sol, fases de Rayleigh y
// Henyey-Greenstein. Con el Sol alto da cielo azul con horizonte claro;
// con el Sol a 2° (Baleares) la luz llega ámbar y el cénit se apaga.
vec3 cieloDia(float alt, float az) {
  float mVista = 1.0 / (sin(radians(max(alt, 0.0))) + 0.12);
  float mSol   = 1.0 / (sin(radians(max(uSolAltAz.x, 0.4))) + 0.12);
  vec3  betaR  = vec3(0.055, 0.13, 0.28);
  float betaM  = 0.035;
  vec3  beta   = betaR + betaM;
  vec3  tVista = exp(-beta * mVista);
  vec3  tSol   = exp(-beta * mSol * 0.9);
  float cosG   = cosAngulo(vec2(alt, az), uSolAltAz);
  float faseR  = 0.0596831 * (1.0 + cosG * cosG);
  float g      = 0.68;
  float faseM  = 0.0796 * (1.0 - g * g)
               / pow(1.0 + g * g - 2.0 * g * cosG, 1.5);
  vec3 luzSol = tSol * 17.0;
  return luzSol * (betaR * faseR + vec3(betaM) * faseM) / beta
       * (1.0 - tVista);
}

// --- terreno ---------------------------------------------------------------
// Perfil periódico en 360°: réplica exacta de alturaTerreno (cielo-luz.ts).
float perfilTerreno(float az, float amplitud, float fase) {
  float a = radians(az);
  float s = 0.42
          + 0.30 * sin( 7.0 * a + fase)
          + 0.19 * sin(17.0 * a + fase * 2.3)
          + 0.09 * sin(31.0 * a + fase * 3.7);
  return amplitud * max(0.06, s);
}

// --- limbo lunar irregular -------------------------------------------------
// Réplica de rugosidadLimbo (cielo-limbo.ts): montañas y valles reales del
// borde de la Luna, la causa física de las perlas de Baily.
float rugLimbo(float ang) {
  float r = 0.0;
  for (int i = 0; i < 8; i++) {
    r += uLimbo[i].y * cos(uLimbo[i].x * ang + uLimbo[i].z);
  }
  return r;
}

// Oscurecimiento del limbo solar: I(mu) fotométrico aproximado. El borde
// del disco es más tenue y más cálido que el centro — nunca un disco plano.
float oscLimboSolar(float dSol) {
  float mu = sqrt(max(0.0, 1.0 - (dSol * dSol) / (uRSol * uRSol)));
  return 0.36 + 0.64 * pow(mu, 0.55);
}

// Manchas solares sutiles (máximo solar 2026): dos grupos fijos en
// coordenadas del disco (fracciones del radio), umbra + penumbra suaves.
float manchasSolares(vec2 rel) {
  vec2 p = rel / uRSol;
  float m = 1.0;
  vec2 d1 = p - vec2(-0.34, 0.16);
  m -= 0.50 * exp(-dot(d1, d1) / 0.0012) + 0.25 * exp(-dot(d1, d1) / 0.005);
  vec2 d2 = p - vec2(0.41, -0.27);
  m -= 0.42 * exp(-dot(d2, d2) / 0.0008) + 0.20 * exp(-dot(d2, d2) / 0.0035);
  return clamp(m, 0.0, 1.0);
}

void main() {
  vec2 pix = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); // y hacia abajo
  float alt = (uYHor - pix.y) / uPpg;
  float az  = uAzCentro + (pix.x - uRes.x * 0.5) / uPpg;

  // Geometría de los discos, común a todos los modos.
  vec2 relSol = pix - uSolPx;
  float dSol = length(relSol);
  vec2 relLuna = pix - uLunaPx;
  float dLuna = length(relLuna);
  float angLuna = atan(relLuna.y, relLuna.x);
  // Limbo lunar irregular: el radio efectivo varía con el ángulo.
  float rLunaEf = uRLuna * (1.0 + uRugosidad * rugLimbo(angLuna));
  float enLuna = 1.0 - smoothstep(rLunaEf - 1.2, rLunaEf + 1.2, dLuna);

  // ---- Vista con gafas de eclipse: filtro solar homologado ---------------
  // Todo negro salvo la fotosfera: disco naranja NÍTIDO con oscurecimiento
  // de limbo y manchas, mordido por el limbo lunar irregular. En la
  // Totalidad no se ve nada — exactamente el mensaje de seguridad.
  if (uGafas > 0.5) {
    float discoG = 1.0 - smoothstep(uRSol - 1.5, uRSol + 1.5, dSol);
    vec3 cG = vec3(1.0, 0.42, 0.06)
            * discoG * oscLimboSolar(dSol) * manchasSolares(relSol)
            * (1.0 - enLuna);
    cG = pow(cG, vec3(1.0 / 2.2));
    cG += (hash(pix + fract(uTiempo)) - 0.5) / 255.0;
    gl_FragColor = vec4(cG, 1.0);
    return;
  }

  // ---- 1. Atmósfera (airlight: SIEMPRE delante de Sol, Luna y corona) ----
  vec3 dia = cieloDia(alt, az) * uBrillo;

  // Sombra de la umbra: oscurece el cielo hacia el acimut de llegada.
  float haciaSombra = 0.5 + 0.5 * cos(radians(az - uAzSombra));
  dia *= 1.0 - uSombraInt * (0.35 + 0.4 * haciaSombra);

  // Cielo de Totalidad: azul-gris profundo, NO negro, algo más claro
  // hacia el horizonte (referencia ESO eso1912j).
  float sinLuz = clamp(1.0 - uBrillo / 0.10, 0.0, 1.0);
  vec3 nocturno = mix(vec3(0.020, 0.028, 0.052),
                      vec3(0.058, 0.072, 0.115),
                      exp(-max(alt, 0.0) / 14.0)) * sinLuz;

  // Anillo crepuscular de 360°: naranja-salmón pegado al horizonte, la luz
  // del día fuera de la umbra. Más tenue hacia el acimut de la sombra.
  float perfilAnillo = exp(-max(alt, 0.0) / 5.0);
  vec3 colAnillo = mix(vec3(1.0, 0.42, 0.20), vec3(0.95, 0.62, 0.42),
                       clamp(alt / 7.0, 0.0, 1.0));
  vec3 anillo = colAnillo * uAnillo360 * perfilAnillo
              * (1.0 - 0.55 * uSombraInt * haciaSombra) * 0.55;

  vec3 fondo = dia + nocturno + anillo;

  // ---- 2. Capa solar ------------------------------------------------------
  // A simple vista el Sol es GLARE: el bloom analítico domina fuera de la
  // Totalidad y el disco es solo un núcleo saturado dentro del halo.
  // OJO con las capas: la aureola es dispersión atmosférica DELANTE de la
  // Luna (no se ocluye — antes de C1 la Luna es realmente invisible);
  // fotosfera, protuberancias y corona están DETRÁS (sí se ocluyen).
  float halo = uFotosfera * uRSol * uRSol
             / (dSol * dSol + uRSol * uRSol * 0.04);
  vec3 aureola = uTinte * (halo * halo * 4.5 + halo * 0.8);
  vec3 solar = vec3(0.0);

  // Núcleo de fotosfera con oscurecimiento de limbo real: el borde es más
  // tenue y más cálido que el centro (nunca un disco plano), con 1–2
  // grupos de manchas sutiles (máximo solar 2026). El hombro suave hacia
  // el halo funde el disco con su propio resplandor.
  float nucleoSol = 1.0 - smoothstep(uRSol * 0.62, uRSol * 1.15, dSol);
  float oscL = oscLimboSolar(min(dSol, uRSol));
  vec3 colorFot = mix(vec3(1.0, 0.55, 0.26), vec3(1.0, 0.985, 0.94), oscL);
  solar += uTinte * colorFot * nucleoSol * oscL * manchasSolares(relSol) * 30.0;

  // Protuberancias rosadas en el limbo (visibles en Totalidad): bucles de
  // hidrógeno en 3 posiciones fijas, pegados por fuera del limbo solar.
  // Al vivir en la capa solar, la Luna las va cubriendo y descubriendo:
  // solo asoman junto a C2/C3 y en los bordes, como en la realidad.
  if (uAlfaCorona > 0.001) {
    float angSol = atan(relSol.y, relSol.x);
    float fueraDisco = clamp((dSol - uRSol * 0.98) / (uRSol * 0.05), 0.0, 1.0);
    float prom = 0.0;
    for (int i = 0; i < 3; i++) {
      float angP = i == 0 ? 0.9 : (i == 1 ? 2.7 : 5.3);
      float anchoP = i == 1 ? 0.10 : 0.06;
      float altoP = i == 1 ? 0.10 : 0.055;
      float dAngP = abs(mod(angSol - angP + PI, 2.0 * PI) - PI);
      prom += exp(-dAngP * dAngP / (anchoP * anchoP))
            * exp(-max(dSol - uRSol, 0.0) / (uRSol * altoP));
    }
    solar += vec3(1.0, 0.38, 0.44) * prom * fueraDisco * uAlfaCorona * 5.0;
  }

  // Corona: textura real modulada (ver cabecera). Centrada en la LUNA.
  if (uAlfaCorona > 0.001) {
    vec2 rel = pix - uLunaPx;
    float rLun = length(rel) / uRLuna;      // en radios lunares
    float rot = uTiempo * 0.0045;           // rotación lenta, casi subliminal
    float c = cos(rot); float s = sin(rot);
    vec2 uv = mat2(c, -s, s, c) * rel / uEscCorona;
    float tex = texture2D(uCorona, uv * 0.5 + 0.5).r;
    // Corona analítica de respaldo (textura sin cargar): elipse suave.
    float resp = exp(-(rLun - 1.0) * 1.1) * 0.55;
    float base = mix(resp, tex, uCoronaLista);
    // Caída radial extra: junto a la de la foto, ~1/r^2.5 total.
    float caida = pow(clamp(rLun, 1.0, 9.0), -1.3);
    // Ruido sutil animado: la corona "respira" sin dejar de ser la real.
    float ang = atan(rel.y, rel.x);
    float ruido = 0.93 + 0.07 * sin(ang * 5.0 + uTiempo * 0.21)
                       * sin(rLun * 6.0 - uTiempo * 0.13);
    // Gradiente vertical de extinción: la mitad baja se apaga (Sol bajo).
    float extV = 1.0 - uGradExt * clamp(rel.y / (uRLuna * 4.0) + 0.35, 0.0, 1.0);
    // Resplandor interno pegado al limbo (cubre la costura de la máscara).
    float interno = exp(-(rLun - 1.0) * 6.0) * 0.9;
    solar += uTinte * (base * caida * ruido + interno)
           * extV * uAlfaCorona * 2.6;
  }

  // ---- 3. Luna oclusora --------------------------------------------------
  // El disco lunar (con su limbo irregular, calculado arriba) tapa la capa
  // solar; su luminancia es la del cielo que tiene delante (airlight) por
  // el factor de acoplamiento: jamás un borde duro contra cielo claro,
  // silueta natural contra el Sol y la corona. En Totalidad queda negra
  // absoluta salvo un levísimo earthshine azulado.
  float sinLuzLuna = clamp(1.0 - uBrillo / 0.10, 0.0, 1.0);
  vec3 earthshine = vec3(0.0035, 0.0045, 0.0070) * sinLuzLuna;
  vec3 color = fondo * mix(1.0, uFactorLuna, enLuna)
             + earthshine * enLuna
             + aureola
             + solar * (1.0 - enLuna);

  // ---- 4. Cromosfera, anillo de diamante y perlas (sobre el limbo) -------
  if (uCromo > 0.001) {
    float anilloCromo = exp(-abs(dSol - uRSol) / (uRSol * 0.018));
    float angPix = atan(pix.y - uSolPx.y, pix.x - uSolPx.x);
    float dAng = abs(mod(angPix - uAngContacto + PI, 2.0 * PI) - PI);
    float arco = exp(-dAng * dAng * 1.4);
    color += vec3(1.0, 0.30, 0.38) * anilloCromo * arco * uCromo * 4.0
           * (1.0 - enLuna);
  }

  if (uDiamante > 0.001) {
    // Anillo fino de fotosfera alrededor del limbo…
    float anillo = exp(-abs(dSol - uRSol) / (uRSol * 0.014));
    color += uTinte * anillo * uDiamante * 2.2;
    // …y el destello en el punto de contacto (referencia NASA: núcleo
    // saturado y puntas finas en aspa).
    vec2 pC = uSolPx + uRSol * vec2(cos(uAngContacto), sin(uAngContacto));
    vec2 relD = pix - pC;
    float dD = length(relD);
    float nucleo = uRSol * (0.10 + 0.30 * uDiamante);
    float destello = nucleo * nucleo / (dD * dD + nucleo * nucleo * 0.08);
    float angD = atan(relD.y, relD.x);
    float aspas = pow(abs(cos(2.0 * (angD - uAngContacto - PI * 0.25))), 24.0);
    color += vec3(1.0, 0.97, 0.90)
           * (destello * destello * 26.0 + destello * aspas * 3.0)
           * uDiamante;
  }

  // Perlas de Baily: fotosfera colándose por los VALLES reales del limbo
  // lunar irregular (cielo-limbo.ts) cercanos al punto de contacto.
  if (uPerlasInt > 0.001) {
    for (int i = 0; i < 6; i++) {
      if (float(i) >= uNumPerlas) break;
      vec3 p = uPerlas[i];
      vec2 pP = uSolPx + uRSol * vec2(cos(p.x), sin(p.x));
      float dP = distance(pix, pP);
      float rP = uRSol * 0.030 * (0.5 + p.y);
      color += uTinte * exp(-dP * dP / (rP * rP * 2.0))
             * (0.4 + 0.6 * p.y) * uPerlasInt * 12.0;
    }
  }

  // ---- 5. Terreno (siluetas con parallax + suelo) ------------------------
  // Capas de lejos a cerca; la más cercana manda. Cada una lleva bruma
  // (mezcla con el cielo de su horizonte) y la luz ambiente real.
  float azRel = az - uAzCentro;
  vec3 brumaHor = fondo;
  // capa lejana
  float h0 = perfilTerreno(uAzCentro + azRel * 1.0,   1.5, 0.0);
  float h1 = perfilTerreno(uAzCentro + azRel * 1.045, 2.6, 2.1);
  float h2 = perfilTerreno(uAzCentro + azRel * 1.09,  3.8, 4.4);
  float aa = 1.2 / uPpg; // suavizado del filo en grados
  float c0 = 1.0 - smoothstep(h0 - aa, h0 + aa, alt);
  float c1 = 1.0 - smoothstep(h1 - aa, h1 + aa, alt);
  float c2 = 1.0 - smoothstep(h2 - aa, h2 + aa, alt);
  vec3 t0 = mix(uLuzAmb * vec3(0.55, 0.55, 0.62), brumaHor, 0.55);
  vec3 t1 = mix(uLuzAmb * vec3(0.38, 0.38, 0.45), brumaHor, 0.28);
  // primer plano: se oscurece hacia abajo con la luz real
  float bajoHor = clamp(-alt / 14.0, 0.0, 1.0);
  vec3 t2 = uLuzAmb * vec3(0.30, 0.30, 0.34) * (1.0 - 0.65 * bajoHor);
  color = mix(color, t0, c0);
  color = mix(color, t1, c1);
  color = mix(color, t2, c2);

  // ---- 6. Tonemap fílmico + gamma + dither -------------------------------
  color = 1.0 - exp(-color * 1.25);
  color = pow(color, vec3(1.0 / 2.2));
  color += (hash(pix + fract(uTiempo)) - 0.5) / 255.0; // sin bandas
  gl_FragColor = vec4(color, 1.0);
}
`;

const VERT_ESTRELLAS = `
attribute vec2 aAltAz;    // grados
attribute vec3 aColor;
attribute vec2 aTamUmbral; // (tamaño px a escala 1, umbral de aparición)
uniform vec2  uRes;
uniform float uPpg;
uniform float uYHor;
uniform float uAzCentro;
uniform float uBrillo;
uniform float uEscala;    // dpr × escala de calidad
varying vec3 vColor;
varying float vAlfa;
void main() {
  float dAz = mod(aAltAz.y - uAzCentro + 540.0, 360.0) - 180.0;
  vec2 px = vec2(uRes.x * 0.5 + dAz * uPpg, uYHor - aAltAz.x * uPpg);
  vec2 clip = vec2(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  // Mismo fundido que alfaAparicion (cielo-estrellas.ts), por frame y sin
  // saltos; extinción suave pegada al horizonte.
  float alfa = clamp(1.0 - uBrillo / aTamUmbral.y, 0.0, 1.0);
  alfa *= clamp(aAltAz.x / 8.0, 0.25, 1.0);
  vColor = aColor;
  vAlfa = alfa;
  gl_PointSize = aTamUmbral.x * uEscala * 2.6;
}
`;

const FRAG_ESTRELLAS = `
precision highp float;
uniform vec2 uLunaPx;
uniform float uRLuna;
uniform vec2 uRes;
varying vec3 vColor;
varying float vAlfa;
void main() {
  // La Luna oculta estrellas (px del fragmento, y hacia abajo).
  vec2 pix = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  if (distance(pix, uLunaPx) < uRLuna) discard;
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float nucleo = exp(-r2 * 5.0);
  gl_FragColor = vec4(vColor, vAlfa * nucleo);
}
`;

// ---------------------------------------------------------------------------
// Utilidades GL
// ---------------------------------------------------------------------------

function compilar(
  gl: WebGLRenderingContext,
  tipo: number,
  fuente: string,
): WebGLShader {
  const shader = gl.createShader(tipo)!;
  gl.shaderSource(shader, fuente);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const registro = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader no compila: ${registro}`);
  }
  return shader;
}

function crearPrograma(
  gl: WebGLRenderingContext,
  vert: string,
  frag: string,
): WebGLProgram {
  const programa = gl.createProgram()!;
  gl.attachShader(programa, compilar(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(programa, compilar(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(programa);
  if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) {
    throw new Error(`Programa no enlaza: ${gl.getProgramInfoLog(programa)}`);
  }
  return programa;
}

/**
 * Crea el renderizador WebGL sobre un canvas, o devuelve `null` si WebGL
 * no está disponible (el llamante cae al canvas 2D de `cielo-draw`).
 */
export function crearRendererCielo(
  canvas: HTMLCanvasElement,
): RendererCielo | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = (canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    }) ?? null) as WebGLRenderingContext | null;
  } catch {
    return null;
  }
  if (!gl) return null;
  const ctx = gl;

  // --- Programas y geometría ----------------------------------------------
  let progCielo: WebGLProgram;
  let progEstrellas: WebGLProgram;
  try {
    progCielo = crearPrograma(ctx, VERT_CIELO, FRAG_CIELO);
    progEstrellas = crearPrograma(ctx, VERT_ESTRELLAS, FRAG_ESTRELLAS);
  } catch (error) {
    // Shaders no soportados: mejor el fallback 2D que un cuadro roto.
    // El aviso (una sola vez) deja diagnóstico en consola.
    console.warn("VistaCielo: WebGL no disponible, fallback 2D.", error);
    return null;
  }

  const quad = ctx.createBuffer();
  ctx.bindBuffer(ctx.ARRAY_BUFFER, quad);
  ctx.bufferData(
    ctx.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    ctx.STATIC_DRAW,
  );

  const bufEstrellas = ctx.createBuffer();

  // Uniformes por nombre (dos mapas, uno por programa).
  const u = (p: WebGLProgram, nombre: string) => ctx.getUniformLocation(p, nombre);
  const aPosCielo = ctx.getAttribLocation(progCielo, "aPos");
  const attrsEstrellas = {
    aAltAz: ctx.getAttribLocation(progEstrellas, "aAltAz"),
    aColor: ctx.getAttribLocation(progEstrellas, "aColor"),
    aTamUmbral: ctx.getAttribLocation(progEstrellas, "aTamUmbral"),
  };

  // --- Textura de corona (async; hasta entonces, respaldo analítico) ------
  const textura = ctx.createTexture();
  ctx.bindTexture(ctx.TEXTURE_2D, textura);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
  ctx.texImage2D(
    ctx.TEXTURE_2D, 0, ctx.LUMINANCE, 1, 1, 0,
    ctx.LUMINANCE, ctx.UNSIGNED_BYTE, new Uint8Array([0]),
  );
  let coronaLista = 0;
  let destruido = false;
  const imagen = new Image();
  imagen.onload = () => {
    // El renderer puede haberse destruido antes de que cargue la imagen
    // (StrictMode monta doble): no tocar una textura ya liberada.
    if (destruido) return;
    ctx.bindTexture(ctx.TEXTURE_2D, textura);
    ctx.texImage2D(
      ctx.TEXTURE_2D, 0, ctx.LUMINANCE, ctx.LUMINANCE,
      ctx.UNSIGNED_BYTE, imagen,
    );
    coronaLista = 1;
  };
  imagen.src = RUTA_TEXTURA_CORONA;

  // Armónicos del limbo lunar irregular: constantes de la sesión.
  ctx.useProgram(progCielo);
  const datosLimbo = new Float32Array(NUM_ARMONICOS_LIMBO * 3);
  ARMONICOS_ECLIPSE.forEach((a, i) => {
    datosLimbo[i * 3] = a.frecuencia;
    datosLimbo[i * 3 + 1] = a.amplitud;
    datosLimbo[i * 3 + 2] = a.fase;
  });
  ctx.uniform3fv(ctx.getUniformLocation(progCielo, "uLimbo"), datosLimbo);
  ctx.uniform1f(
    ctx.getUniformLocation(progCielo, "uRugosidad"),
    RUGOSIDAD_RENDER,
  );

  // Búfer CPU de estrellas: se reconstruye solo cuando cambia el lote de
  // cuerpos (cacheado por segundo por el llamante).
  let cuerposPrevios: CuerpoDomo[] | null = null;
  let numEstrellas = 0;

  function subirEstrellas(cuerpos: CuerpoDomo[]): void {
    // (alt, az, r, g, b, tam, umbral) × N — el filtro de terreno lo hace
    // el llamante; aquí solo descartamos lo hundido bajo el horizonte.
    const datos: number[] = [];
    for (const c of cuerpos) {
      if (c.altitud < 0) continue;
      datos.push(
        c.altitud, c.acimut,
        c.color[0], c.color[1], c.color[2],
        c.tam, c.umbral,
      );
    }
    numEstrellas = datos.length / 7;
    ctx.bindBuffer(ctx.ARRAY_BUFFER, bufEstrellas);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array(datos), ctx.DYNAMIC_DRAW);
  }

  return {
    redimensionar(ancho: number, alto: number): void {
      if (canvas.width !== ancho) canvas.width = ancho;
      if (canvas.height !== alto) canvas.height = alto;
    },

    dibujar(f: FotogramaCieloGL): void {
      const { cfg } = f;
      ctx.viewport(0, 0, cfg.ancho, cfg.alto);

      const esc = escenaSolLuna(f.posiciones, cfg);
      const ppg = pxPorGrado(cfg);
      const yHor = yHorizonte(cfg);
      const tinte = tinteExtincion(f.posiciones.sol.altitud);
      const amb = luzAmbiente(f.brillo);
      const sombra = sombraLateral(f.tMs, f.c2Ms, f.c3Ms, cfg.acimutCentro);
      const antesDeC2 = f.c2Ms !== null && f.tMs < f.c2Ms;
      const angulo = anguloContacto(esc.sol, esc.luna);

      // --- pase 1: el cielo entero -----------------------------------------
      ctx.disable(ctx.BLEND);
      ctx.useProgram(progCielo);
      ctx.uniform2f(u(progCielo, "uRes"), cfg.ancho, cfg.alto);
      ctx.uniform1f(u(progCielo, "uPpg"), ppg);
      ctx.uniform1f(u(progCielo, "uYHor"), yHor);
      ctx.uniform1f(u(progCielo, "uAzCentro"), cfg.acimutCentro);
      ctx.uniform2f(
        u(progCielo, "uSolAltAz"),
        f.posiciones.sol.altitud,
        f.posiciones.sol.acimut,
      );
      ctx.uniform2f(u(progCielo, "uSolPx"), esc.sol.x, esc.sol.y);
      ctx.uniform2f(u(progCielo, "uLunaPx"), esc.luna.x, esc.luna.y);
      ctx.uniform1f(u(progCielo, "uRSol"), esc.sol.radio);
      ctx.uniform1f(u(progCielo, "uRLuna"), esc.luna.radio);
      ctx.uniform1f(u(progCielo, "uBrillo"), f.brillo);
      ctx.uniform1f(u(progCielo, "uFotosfera"), 1 - f.obscuracion);
      ctx.uniform1f(u(progCielo, "uFactorLuna"), factorLuna(f.brillo));
      ctx.uniform1f(
        u(progCielo, "uAnillo360"),
        intensidadAnillo360(f.brillo, f.enTotalidad),
      );
      ctx.uniform1f(
        u(progCielo, "uAlfaCorona"),
        alfaCorona(f.brillo, f.enTotalidad),
      );
      ctx.uniform1f(
        u(progCielo, "uCromo"),
        intensidadCromosfera(f.tMs, f.c2Ms, f.c3Ms),
      );
      ctx.uniform1f(u(progCielo, "uAngContacto"), angulo);
      ctx.uniform1f(
        u(progCielo, "uDiamante"),
        intensidadAnilloDiamante(f.tMs, f.c2Ms, f.c3Ms),
      );
      // Perlas físicas: los valles del limbo lunar cercanos al contacto.
      const perlasInt = intensidadPerlas(f.tMs, f.c2Ms, f.c3Ms);
      ctx.uniform1f(u(progCielo, "uPerlasInt"), perlasInt);
      const perlas = perlasInt > 0 ? perlasDesdeLimbo(angulo) : [];
      const datosPerlas = new Float32Array(18);
      perlas.forEach((p, i) => {
        datosPerlas[i * 3] = p.angulo;
        datosPerlas[i * 3 + 1] = p.profundidad;
      });
      ctx.uniform3fv(u(progCielo, "uPerlas"), datosPerlas);
      ctx.uniform1f(u(progCielo, "uNumPerlas"), perlas.length);
      ctx.uniform1f(u(progCielo, "uGafas"), f.modoGafas ? 1 : 0);
      ctx.uniform1f(u(progCielo, "uSombraInt"), sombra.intensidad);
      ctx.uniform1f(
        u(progCielo, "uAzSombra"),
        antesDeC2 ? ACIMUT_UMBRA_LLEGA : ACIMUT_UMBRA_SE_VA,
      );
      ctx.uniform3f(u(progCielo, "uTinte"), tinte[0], tinte[1], tinte[2]);
      ctx.uniform1f(
        u(progCielo, "uGradExt"),
        gradienteExtincion(f.posiciones.sol.altitud),
      );
      ctx.uniform3f(u(progCielo, "uLuzAmb"), amb[0], amb[1], amb[2]);
      ctx.uniform1f(u(progCielo, "uTiempo"), f.tAnimS);
      ctx.activeTexture(ctx.TEXTURE0);
      ctx.bindTexture(ctx.TEXTURE_2D, textura);
      ctx.uniform1i(u(progCielo, "uCorona"), 0);
      ctx.uniform1f(u(progCielo, "uCoronaLista"), coronaLista);
      ctx.uniform1f(
        u(progCielo, "uEscCorona"),
        esc.luna.radio / FRACCION_LIMBO_CORONA,
      );

      ctx.bindBuffer(ctx.ARRAY_BUFFER, quad);
      ctx.enableVertexAttribArray(aPosCielo);
      ctx.vertexAttribPointer(aPosCielo, 2, ctx.FLOAT, false, 0, 0);
      ctx.drawArrays(ctx.TRIANGLES, 0, 3);

      // --- pase 2: estrellas y planetas (aditivo) --------------------------
      if (f.cuerpos !== cuerposPrevios) {
        cuerposPrevios = f.cuerpos;
        subirEstrellas(f.cuerpos);
      }
      if (numEstrellas > 0 && f.brillo < 0.32) {
        ctx.enable(ctx.BLEND);
        ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE);
        ctx.useProgram(progEstrellas);
        ctx.uniform2f(u(progEstrellas, "uRes"), cfg.ancho, cfg.alto);
        ctx.uniform1f(u(progEstrellas, "uPpg"), ppg);
        ctx.uniform1f(u(progEstrellas, "uYHor"), yHor);
        ctx.uniform1f(u(progEstrellas, "uAzCentro"), cfg.acimutCentro);
        ctx.uniform1f(u(progEstrellas, "uBrillo"), f.brillo);
        ctx.uniform1f(u(progEstrellas, "uEscala"), ppg / 9.6);
        ctx.uniform2f(u(progEstrellas, "uLunaPx"), esc.luna.x, esc.luna.y);
        ctx.uniform1f(u(progEstrellas, "uRLuna"), esc.luna.radio);
        ctx.bindBuffer(ctx.ARRAY_BUFFER, bufEstrellas);
        const BYTES = 7 * 4;
        ctx.enableVertexAttribArray(attrsEstrellas.aAltAz);
        ctx.vertexAttribPointer(attrsEstrellas.aAltAz, 2, ctx.FLOAT, false, BYTES, 0);
        ctx.enableVertexAttribArray(attrsEstrellas.aColor);
        ctx.vertexAttribPointer(attrsEstrellas.aColor, 3, ctx.FLOAT, false, BYTES, 8);
        ctx.enableVertexAttribArray(attrsEstrellas.aTamUmbral);
        ctx.vertexAttribPointer(attrsEstrellas.aTamUmbral, 2, ctx.FLOAT, false, BYTES, 20);
        ctx.drawArrays(ctx.POINTS, 0, numEstrellas);
      }
    },

    destruir(): void {
      destruido = true;
      ctx.deleteBuffer(quad);
      ctx.deleteBuffer(bufEstrellas);
      ctx.deleteTexture(textura);
      ctx.deleteProgram(progCielo);
      ctx.deleteProgram(progEstrellas);
    },
  };
}
