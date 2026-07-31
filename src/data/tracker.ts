export type Handle = string;

export type Problem = {
  id: string;
  name: string;
  url: string;
  solvedBy: Record<Handle, boolean>;
  submissionUrls?: Record<Handle, string>;
  submissionIds?: Record<Handle, string>;
};

export type TrackerDay = {
  date: string; // ISO yyyy-mm-dd
  problems: Problem[];
};

export const handles: Handle[] = [
  "-CHUNU-",
  "Arman42",
  "HossainMohammad",
  "CrazyCoder00",
  "Wasif_Jamil",
  "AkibAzmain",
];

const emptySolves = (): Record<Handle, boolean> => ({
  "-CHUNU-": false,
  "Arman42": false,
  "HossainMohammad": false,
  "CrazyCoder00": false,
  "Wasif_Jamil": false,
  "AkibAzmain": false,
});

const emptyUrls = (): Record<Handle, string> => ({
  "-CHUNU-": "",
  "Arman42": "",
  "HossainMohammad": "",
  "CrazyCoder00": "",
  "Wasif_Jamil": "",
  "AkibAzmain": "",
});

const emptyIds = (): Record<Handle, string> => ({
  "-CHUNU-": "",
  "Arman42": "",
  "HossainMohammad": "",
  "CrazyCoder00": "",
  "Wasif_Jamil": "",
  "AkibAzmain": "",
});

export const days: TrackerDay[] = [
  {
    date: "2026-07-31",
    problems: [
      {
        id: "1312E",
        name: "Array Shrinking",
        url: "https://codeforces.com/contest/1312/problem/E",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "1364D",
        name: "Ehab's Last Corollary",
        url: "https://codeforces.com/contest/1364/problem/D",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "1684E",
        name: "MEX vs DIFF",
        url: "https://codeforces.com/contest/1684/problem/E",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "1510D",
        name: "Digits",
        url: "https://codeforces.com/contest/1510/problem/D",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "1975E",
        name: "Chain Queries",
        url: "https://codeforces.com/contest/1975/problem/E",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
    ],
  },
  {
    date: "2026-07-30",
    problems: [
      {
        id: "1748D",
        name: "ConstructOR",
        url: "https://codeforces.com/contest/1748/problem/D",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "1217D",
        name: "Coloring Edges",
        url: "https://codeforces.com/contest/1217/problem/D",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "1207F",
        name: "Remainder Problem",
        url: "https://codeforces.com/contest/1207/problem/F",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "2038B",
        name: "Make It Equal",
        url: "https://codeforces.com/contest/2038/problem/B",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "1560F2",
        name: "Nearest Beautiful Number (hard version)",
        url: "https://codeforces.com/contest/1560/problem/F2",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
    ],
  },
  {
    date: "2026-07-29",
    problems: [
      {
        id: "1499D",
        name: "The Number of Pairs",
        url: "https://codeforces.com/contest/1499/problem/D",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "1761D",
        name: "Carry Bit",
        url: "https://codeforces.com/contest/1761/problem/D",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "1778D",
        name: "Flexible String Revisit",
        url: "https://codeforces.com/contest/1778/problem/D",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "1433F",
        name: "Zero Remainder Sum",
        url: "https://codeforces.com/contest/1433/problem/F",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
      {
        id: "1637E",
        name: "Best Pair",
        url: "https://codeforces.com/contest/1637/problem/E",
        solvedBy: emptySolves(),
        submissionUrls: emptyUrls(),
        submissionIds: emptyIds(),
      },
    ],
  },
];
