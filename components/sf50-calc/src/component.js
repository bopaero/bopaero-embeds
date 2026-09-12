(function () {
    // ===== Constants (SF50 shared ownership) =====
    const TOTAL_SHARES = 8;
    const SCHEDULING_HOURS_AT_ONE_TIME = 175;
    const SCHEDULING_DAYS_AT_ONE_TIME = 35;
    const PROGRAM_COST = 544375;
    const ANNUAL_PROGRAM_FEE = 131291;
    const FUEL_COST_FALLBACK = 375;
    const SF50_GPH = 59;
    const SF50_OIL_PER_HR = 6.45;
    const HR_SUFFIX = " /hr";

    // ===== Helpers =====
    const formatCurrency0 = (num) =>
      num.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });

    // ===== Live Fuel Price =====
    const FUEL_PRICES_URL =
      'https://raw.githubusercontent.com/bopaero/bopaeroFlightCalc/main/data/fuel_prices.json';

    function computeFuelCostPerHour(pricePerGal) {
      return Math.round(pricePerGal * SF50_GPH + SF50_OIL_PER_HR);
    }

    function initializeCalculator() {
      const root = document.getElementById('sf50-calc');
      if (!root) return;

      const yearsEl = root.querySelector('#ownership-years');
      const hoursEl = root.querySelector('#hours-per-year');
      const calculateButton = root.querySelector('#calculate-cost');
      const clearButton = root.querySelector('#clear-calculator');
      const blendedCostEl = root.querySelector('#blended-cost-per-hour');
      const fuelCostEl = root.querySelector('#fuel-cost');
      const fuelNoteEl = root.querySelector('#fuel-note');

      root.addEventListener('toggle', function () {
        if (this.open) {
          this.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });

      root.querySelector('#share-position').innerText =
        `Ownership Costs (per share)`;
      root.querySelector('#share-usage').innerText = 'Unlimited';
      root.querySelector('#scheduling-limit').innerText =
        `${SCHEDULING_HOURS_AT_ONE_TIME} flight hours or ` +
        `${SCHEDULING_DAYS_AT_ONE_TIME} days at one time`;
      root.querySelector('#program-cost').innerText =
        `$${formatCurrency0(PROGRAM_COST)}`;
      root.querySelector('#annual-program-fee').innerText =
        `$${formatCurrency0(ANNUAL_PROGRAM_FEE)}`;
      fuelCostEl.innerText =
        `$${formatCurrency0(FUEL_COST_FALLBACK)}${HR_SUFFIX}`;

      function applyFuelPrice(pricePerGal, updatedDate) {
        const costPerHr = computeFuelCostPerHour(pricePerGal);
        fuelCostEl.innerText = `$${formatCurrency0(costPerHr)}${HR_SUFFIX}`;

        if (fuelNoteEl) {
          fuelNoteEl.innerText =
            `***JET-A $${pricePerGal.toFixed(2)}/gal ` +
            `(national avg, AirNav.com${updatedDate ? `, updated ${updatedDate}` : ''}) × ` +
            `${SF50_GPH} gph + oil.`;
        }
      }

      function loadFuelPrices() {
        fetch(`${FUEL_PRICES_URL}?v=${new Date().toISOString().slice(0, 10)}`)
          .then(response => response.ok ? response.json() : null)
          .then(data => {
            if (data && data.jet_a) {
              applyFuelPrice(data.jet_a, data.updated);
            }
          })
          .catch(error =>
            console.warn('SF50 fuel price fetch failed:', error.message)
          );
      }

      function calculate() {
        const years = Number(yearsEl.value);
        const hoursPerYear = Number(hoursEl.value);

        if (!Number.isInteger(years) || years < 1 || years > 20) {
          alert('Please enter Years of Ownership as a whole number between 1 and 20.');
          return;
        }

        if (!Number.isFinite(hoursPerYear) || hoursPerYear < 1) {
          alert('Please enter estimated annual flying hours greater than zero.');
          return;
        }

        const ownershipCostTotal =
          PROGRAM_COST + (ANNUAL_PROGRAM_FEE * years);
        const totalHours = years * hoursPerYear;
        const blendedOwnershipPerHour = ownershipCostTotal / totalHours;

        blendedCostEl.innerText =
          `$${formatCurrency0(blendedOwnershipPerHour)}${HR_SUFFIX}`;
      }

      function clearData() {
        yearsEl.value = '';
        hoursEl.value = '';
        blendedCostEl.innerText = '-';
        yearsEl.focus();
      }

      calculateButton.addEventListener('click', calculate);
      clearButton.addEventListener('click', clearData);

      [yearsEl, hoursEl].forEach(element => {
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            calculate();
            element.blur();
          }
        });

        element.addEventListener('blur', () => {
          if (yearsEl.value && hoursEl.value) calculate();
        });
      });

      loadFuelPrices();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeCalculator, { once: true });
    } else {
      initializeCalculator();
    }
  })();
