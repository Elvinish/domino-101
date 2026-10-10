import { useId } from 'react';
import type { TableProp } from './tableDecorData';

/** Small, reusable three-quarter-view objects. No labels, remote URLs or game data. */
export function TablePropArt({ prop }: { prop: TableProp }) {
  const id = useId().replaceAll(':', '');
  const paint = (name: string) => `url(#${id}-${name})`;
  const drinkColor = /water/.test(prop.id)
    ? '#aec1b7'
    : /juice|lemonade/.test(prop.id)
      ? '#dfa83e'
      : '#965017';
  const foodColor = /olives|pistachios/.test(prop.id)
    ? '#88954a'
    : /chocolate|coffee-beans/.test(prop.id)
      ? '#533121'
      : '#c99352';
  return (
    <svg
      className="table-prop-art"
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-ceramic`} x2=".8" y2="1">
          <stop stopColor="#f4e3bf" />
          <stop offset=".55" stopColor="#c5ac86" />
          <stop offset="1" stopColor="#8a6c4d" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x2="1" y2=".4">
          <stop stopColor="#f2dfb09c" />
          <stop offset=".2" stopColor="#fff2c815" />
          <stop offset=".75" stopColor="#f2e0b423" />
          <stop offset="1" stopColor="#ffecbd8c" />
        </linearGradient>
        <linearGradient id={`${id}-bowl`} x2=".6" y2="1">
          <stop stopColor="#c6955f" />
          <stop offset=".4" stopColor="#805332" />
          <stop offset="1" stopColor="#39271b" />
        </linearGradient>
        <radialGradient id={`${id}-coffee`} cx=".35" cy=".35">
          <stop stopColor="#a16b2b" />
          <stop offset=".4" stopColor="#472813" />
          <stop offset="1" stopColor="#201710" />
        </radialGradient>
        <radialGradient id={`${id}-fruit`} cx=".3" cy=".25">
          <stop stopColor="#d59e4f" />
          <stop offset=".4" stopColor="#aa5531" />
          <stop offset="1" stopColor="#552e21" />
        </radialGradient>
      </defs>
      <ellipse cx="61" cy="99" rx="45" ry="10" fill="#170f0c" opacity=".35" />
      {prop.visual === 'coffee' && (
        <>
          <ellipse
            cx="59"
            cy="96"
            rx="44"
            ry="15"
            fill="#54412a"
            stroke="#c2a16a"
            strokeWidth="2"
          />
          <ellipse cx="59" cy="90" rx="39" ry="13" fill={paint('ceramic')} />
          <path
            d="M82 48c32-6 29 39 0 31"
            fill="none"
            stroke="#d9c19b"
            strokeWidth="9"
          />
          <path
            d="M25 42h60l-5 37c-3 18-45 18-49 0z"
            fill={paint('ceramic')}
            stroke="#ead7b0"
          />
          <ellipse cx="55" cy="42" rx="30" ry="14" fill="#f5e8ca" />
          <ellipse cx="55" cy="43" rx="25" ry="10" fill={paint('coffee')} />
          <path d="M36 44q8-7 26-6" fill="none" stroke="#dab474" opacity=".5" />
          {/cappuccino/.test(prop.id) && (
            <path d="M41 43q16-13 28 0-14 11-28 0" fill="#ead4a2" />
          )}
          <path
            d="M35 62v10m9-11v3"
            stroke="#826c4d"
            opacity=".3"
            strokeWidth="2"
          />
        </>
      )}
      {prop.visual === 'drink' && (
        <>
          <ellipse
            cx="59"
            cy="96"
            rx="35"
            ry="12"
            fill="#836038"
            stroke="#c49b59"
          />
          <path
            d="M30 30l4 55c0 18 49 18 51 0l5-55z"
            fill={paint('glass')}
            stroke="#e6ce97"
            strokeWidth="1.3"
          />
          <path
            d="M33 58l2 26c3 12 47 12 49 0l3-26z"
            fill={drinkColor}
            fillOpacity=".75"
          />
          <ellipse
            cx="60"
            cy="58"
            rx="27"
            ry="9"
            fill={drinkColor}
            stroke="#edc574"
            strokeWidth=".6"
          />
          <ellipse
            cx="60"
            cy="30"
            rx="30"
            ry="10"
            fill="#30251b40"
            stroke="#e8d2a3"
            strokeWidth="1.5"
          />
          <path
            d="M38 35l3 44M82 36l-3 49M50 70v17m15-14v17"
            stroke="#ffe6ad"
            opacity=".4"
            strokeWidth="2"
          />
          {/whisky|iced|lemonade|water/.test(prop.id) && (
            <g fill="#eadba76b" stroke="#ffeecc8c">
              <path d="m44 46 12-3 6 10-13 5z" />
              <path d="m66 56 11-4 3 12-12 3z" />
            </g>
          )}
          <ellipse
            cx="59"
            cy="86"
            rx="24"
            ry="6"
            fill="none"
            stroke="#fbe3ad77"
          />
        </>
      )}
      {(prop.visual === 'dish' || prop.visual === 'fruit') && (
        <>
          <path
            d="M17 67q5 36 43 36t43-36"
            fill={paint('bowl')}
            stroke="#b58c60"
          />
          <ellipse
            cx="60"
            cy="65"
            rx="44"
            ry="22"
            fill="#4b3221"
            stroke="#cca271"
            strokeWidth="3"
          />
          {prop.visual === 'fruit' ? (
            prop.id === 'grapes' ? (
              <g fill="#79733f" stroke="#a49b55">
                {[
                  [-14, -4],
                  [1, -10],
                  [17, -2],
                  [-22, 10],
                  [-5, 9],
                  [12, 13],
                  [3, 25],
                ].map(([x, y], i) => (
                  <circle key={i} cx={60 + x!} cy={54 + y!} r="11" />
                ))}
                <path
                  d="M61 41q-4-14 10-19"
                  fill="none"
                  stroke="#634c27"
                  strokeWidth="4"
                />
              </g>
            ) : (
              <>
                <path
                  d="M63 39c-38-12-46 35-19 46 24 19 57-21 35-41-5-6-10-6-16-5"
                  fill={paint('fruit')}
                />
                <path
                  d="M63 40q-7-18 5-22"
                  fill="none"
                  stroke="#554223"
                  strokeWidth="4"
                />
                <path d="M64 30q17-13 21 0-12 10-21 0" fill="#677345" />
              </>
            )
          ) : (
            <g fill={foodColor} stroke="#e1b372" strokeWidth=".7">
              {[
                [-26, -2],
                [-11, -10],
                [7, -9],
                [26, -3],
                [-20, 11],
                [-3, 4],
                [15, 7],
                [0, 17],
                [28, 12],
              ].map(([x, y], i) =>
                /chocolate|cheese|baklava/.test(prop.id) ? (
                  <rect
                    key={i}
                    x={48 + x!}
                    y={52 + y!}
                    width="18"
                    height="12"
                    rx="2"
                    transform={`rotate(${i % 2 ? -12 : 10} ${60 + x!} ${60 + y!})`}
                  />
                ) : (
                  <ellipse
                    key={i}
                    cx={60 + x!}
                    cy={60 + y!}
                    rx={prop.id === 'cookies' ? 11 : 7}
                    ry={prop.id === 'cookies' ? 7 : 5}
                    transform={`rotate(${i * 37} ${60 + x!} ${60 + y!})`}
                  />
                ),
              )}
            </g>
          )}
          <path
            d="M23 80q37 27 74 0"
            fill="none"
            stroke="#d4b282"
            opacity=".25"
          />
        </>
      )}
      {prop.visual === 'ashtray' && (
        <>
          <ellipse
            cx="57"
            cy="87"
            rx="44"
            ry="18"
            fill="#514638"
            stroke="#b8a789"
            strokeWidth="3"
          />
          <ellipse
            cx="57"
            cy="81"
            rx="36"
            ry="13"
            fill="#27251f"
            stroke="#a7987b"
            strokeWidth="3"
          />
          <path
            d="m28 82 10 3m16-3 8 5m5-7 8 4"
            stroke="#867e6c"
            strokeWidth="3"
          />
          {prop.id !== 'ashtray' && (
            <g transform="rotate(-32 69 60)">
              <rect
                x="50"
                y="54"
                width="58"
                height="10"
                rx="4"
                fill={prop.id === 'cigarette' ? '#e3dac0' : '#82502c'}
                stroke="#c19360"
              />
              <rect x="55" y="54" width="8" height="10" fill="#baa065" />
              <path d="M105 55v8" stroke="#d17a38" strokeWidth="3" />
            </g>
          )}
        </>
      )}
      {prop.visual === 'phone' && (
        <g transform="rotate(-12 60 65)">
          <path
            d="m32 22 49 2 6 75-48-3z"
            fill="#171c1c"
            stroke="#a89d89"
            strokeWidth="2"
          />
          <path d="m37 28 39 2 5 58-38-2z" fill="#344141" />
          <path d="m40 31 17 1-13 37z" fill="#ffffff0d" />
          <path d="m54 27 11 1m-8 67 8 1" stroke="#b2ada0" strokeWidth="2" />
        </g>
      )}
      {prop.visual === 'book' && (
        <g transform="rotate(-10 60 65)">
          <path
            d="m21 35 66-4 13 61-65 5z"
            fill="#d5c9aa"
            stroke="#6f5837"
            strokeWidth="2"
          />
          <path d="m21 27 66-4 13 61-65 5z" fill="#5d694e" stroke="#abb38a" />
          <path d="m29 27 13 61" stroke="#293a2c" strokeWidth="3" />
          <path d="m39 84 55-3m-53 9 54-3" stroke="#aa9978" />
          <path d="m45 42 32-2" stroke="#bfbd90" />
          <path d="m48 47 27-2" stroke="#bfbd90" opacity=".5" />
        </g>
      )}
      {prop.visual === 'keys' && (
        <g
          transform="rotate(-25 60 65)"
          fill="#b6a782"
          stroke="#e2d0a2"
          strokeWidth="2"
        >
          <ellipse
            cx="46"
            cy="49"
            rx="15"
            ry="13"
            fill="none"
            strokeWidth="4"
          />
          <path d="m53 58 25 27-5 5-7-5-4 2-15-23z" />
          <circle cx="45" cy="47" r="4" fill="#675d45" />
        </g>
      )}
      {prop.visual === 'candle' && (
        <>
          <ellipse cx="60" cy="97" rx="32" ry="10" fill="#776044" />
          <path d="M39 54h42v34c0 16-42 16-42 0z" fill={paint('ceramic')} />
          <ellipse cx="60" cy="54" rx="21" ry="7" fill="#f6e5bf" />
          <path d="M60 54v-9" stroke="#4d3825" strokeWidth="2" />
          <path
            className="prop-flame"
            d="M60 17c-18 25-9 31 0 31s13-13 0-31"
            fill="#f1c36b"
          />
          <path d="M60 31c-6 12-5 14 0 14s6-5 0-14" fill="#fff3ba" />
        </>
      )}
      {prop.visual === 'plant' && (
        <>
          <path d="M37 72h46l-6 24q-17 9-34 0z" fill={paint('bowl')} />
          <ellipse cx="60" cy="71" rx="23" ry="7" fill="#3e3021" />
          <g className="prop-leaves" fill="#758255" stroke="#a5ab6d">
            <path d="M60 75q-36-13-30-35 26-4 30 35" />
            <path d="M62 76q-10-47 8-55 22 11-8 55" />
            <path d="M59 74q11-38 37-26-4 26-37 26" />
          </g>
        </>
      )}
    </svg>
  );
}
