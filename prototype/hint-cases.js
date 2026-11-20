"use strict";

const validatedCases = {
  restaurant: {
    context: "A restaurant grows from 40 to 60 seats. At lunch it receives 50 orders per hour. The kitchen can prepare at most 35 orders per hour.",
    reason: "Maybe the room still has too few tables, or the kitchen cannot keep up.",
    plan: "I would count how many seats are occupied every ten minutes during lunch.",
    rubric: [
      "Suggests measuring actual kitchen throughput or the order backlog to distinguish seating from kitchen capacity.",
      "Uses compatible units and time windows. Seats cannot be compared directly with orders per hour.",
      "Uses only the given facts. It does not assume that demand, staffing, or kitchen performance changed.",
      "Gives a clue without naming the winning cause or specifying the full measurement and comparison.",
    ],
    fallback: "What could you count at the kitchen pass during lunch to estimate the kitchen’s actual output?",
    hints: [
      { id: "A", text: "How could you compare the number of occupied seats with the kitchen’s limit of 35 orders per hour?", failed: [1] },
      { id: "B", text: "What might the number of orders waiting to be prepared tell you that seat occupancy cannot?", failed: [] },
      { id: "C", text: "How could an increase in staffing have affected the kitchen’s output?", failed: [0, 2] },
      { id: "D", text: "Count orders received and prepared each hour, compare the gap, then conclude the kitchen is the bottleneck.", failed: [3] },
      { id: "E", text: "What could the number of orders the kitchen actually completes per hour tell you about the bottleneck?", failed: [] },
    ],
    followUps: {
      B: [
        "If more orders were waiting at the end of lunch than at the start, which two rates would you compare to explain the growing queue?",
        "How would a queue of orders waiting to be cooked tell a different story from a queue of customers waiting for a seat?",
      ],
      E: [
        "Once you know how many orders the kitchen finishes in an hour, what could you compare that number with for the very same hour?",
        "How could you check whether orders keep piling up during an hour when the kitchen is working and seats are still available?",
      ],
      written: [
        "What would you compare the kitchen’s output with over the same hour to tell whether orders are piling up?",
        "What would you expect to see in the order queue if the dining room still had empty seats but the kitchen could not keep up?",
      ],
    },
  },
  maintenance: {
    context: "A workshop starts cleaning its cutting machine between shifts. That same week it switches to thinner sheets. The machine stops less often.",
    reason: "Cleaning may prevent jams, but thinner sheets might jam less too.",
    plan: "I would compare stoppages per shift for the week before and the week after the change.",
    rubric: [
      "Suggests holding cleaning or sheet thickness constant to test the other explanation for fewer stoppages.",
      "Keeps units and time windows comparable when discussing a comparison.",
      "Uses only the given facts. It does not assume logs exist or treat sheet thickness as unknown.",
      "Gives one clue without specifying both groups and their outcome comparison or naming the winning cause.",
    ],
    fallback: "What would keeping the cleaning routine the same help you find out about the sheets?",
    hints: [
      { id: "A", text: "Could you measure the thickness of the sheets before and after the change?", failed: [0] },
      { id: "B", text: "Use the existing cleaning logs to compare cleaned and uncleaned shifts on thin sheets and count their stops.", failed: [2, 3] },
      { id: "C", text: "What would keeping sheet thickness the same help you find out about cleaning?", failed: [] },
      { id: "D", text: "Compare total stops across one week with stops on a single shift.", failed: [0, 1] },
      { id: "E", text: "Which explanation could you investigate if the cleaning routine stayed the same?", failed: [] },
    ],
  },
  printShop: {
    context: "A print shop receives orders for 100 posters per hour. Each poster passes through printing, trimming, and packing in that order. Their maximum capacities are 90, 60, and 80 posters per hour, respectively. The learner can improve one station.",
    rubric: [
      "Points to completed output or where unfinished posters accumulate, which can distinguish the limiting station.",
      "Keeps output rates in posters per hour or compares queue changes over the same interval.",
      "Uses only the stated workflow and capacities. It does not assume faults or staffing changes.",
      "Leaves the station choice and the comparison to the learner.",
    ],
    fallback: "What could a growing pile of posters waiting for one station tell you about how fast that station can work?",
    hints: [
      { id: "A", text: "Could a broken packing machine explain why posters are piling up?", failed: [0, 2] },
      { id: "B", text: "What would tracking where the queue of unfinished posters grows during the same hour tell you?", failed: [] },
      { id: "C", text: "Compare the number of posters in a pile directly with the printing rate of 90 posters per hour.", failed: [0, 1] },
      { id: "D", text: "Trimming is the bottleneck. Upgrade it first, then compare 80 and 90 to identify the next constraint.", failed: [3] },
      { id: "E", text: "What could the number of posters each station actually completes in one hour tell you about which step limits shipping?", failed: [] },
    ],
    followUps: {
      B: [
        "Once you see where a pile grows, what could you count entering and leaving that station during the same hour?",
        "If a pile grows in front of one station, what would you look for at the next station to tell whether it is waiting for work?",
      ],
      E: [
        "If you know how many posters each station completes in an hour, where would you look for a growing pile to check which stage sets the pace?",
        "If the station you picked worked faster, what would have to change in the hourly packing count to show that more posters were actually shipped?",
      ],
      written: [
        "To test whether a faster station would increase shipping, what would you compare about the output of each station over one hour?",
        "If the station you improve works faster but the hourly packing count stays the same, where would you check for a growing queue next?",
      ],
    },
  },
};

function validateHint(exercise, raw) {
  const proposed = exercise.hints.find(({ id }) => id === raw);
  const accepted = Boolean(proposed && proposed.failed.length === 0);
  return { proposed, accepted, text: accepted ? proposed.text : exercise.fallback };
}

function continuationFor(exercise, firstId) {
  const [first, second] = exercise.followUps[firstId] || exercise.followUps.written;
  return {
    rubric: [...exercise.rubric, "Builds on the first hint by asking the learner to make a new observation or interpret a comparison."],
    hints: [{ id: "NEXT_A", text: first, failed: [] }, { id: "NEXT_B", text: second, failed: [] }],
    fallback: first,
  };
}
