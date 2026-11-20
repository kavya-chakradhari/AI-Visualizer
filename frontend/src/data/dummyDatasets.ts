/**
 * Ready-to-use dummy datasets in standard CSV format for zero-friction testing.
 * Perfect for testing data ingestion pipeline, column profiling, currency,
 * percentages, dates, identifiers, categoricals, and ambiguous mixed-type detection.
 */

export interface DummyDatasetDefinition {
  id: string;
  name: string;
  fileName: string;
  description: string;
  csvContent: string;
}

export const DUMMY_DATASETS: DummyDatasetDefinition[] = [
  {
    id: "saas-metrics",
    name: "SaaS Subscription Metrics",
    fileName: "saas_subscriptions_2024.csv",
    description: "Contains identifiers, currencies, percentages, dates, categoricals, and booleans.",
    csvContent: `subscription_id,customer_name,plan_tier,monthly_revenue,signup_date,churn_risk,is_active,seats_allocated
SUB-1001,Acme Corp,Enterprise,$4,950.00,2023-01-15,4.5%,true,120
SUB-1002,Global Logistics,Professional,$1,200.00,2023-02-10,12.0%,true,35
SUB-1003,Starlight Media,Starter,$299.00,2023-03-01,28.5%,true,8
SUB-1004,Apex Innovations,Enterprise,$6,500.00,2023-03-22,2.1%,true,200
SUB-1005,Nexus Robotics,Professional,$1,550.00,2023-04-05,15.8%,false,40
SUB-1006,Blue Horizon,Starter,$299.00,2023-05-18,34.0%,true,10
SUB-1007,Quantum Dynamics,Enterprise,$8,200.00,2023-06-12,1.2%,true,350
SUB-1008,Peak Performance,Professional,$1,400.00,2023-07-01,9.7%,true,45
SUB-1009,Swift Logistics,Starter,$199.00,2023-08-14,42.0%,false,5
SUB-1010,Vanguard Tech,Enterprise,$5,100.00,2023-09-02,5.0%,true,140
SUB-1011,Echo Systems,Professional,$1,800.00,2023-09-25,11.3%,true,50
SUB-1012,Orbit Cloud,Starter,$349.00,2023-10-10,19.2%,true,12
SUB-1013,Solaris Energy,Enterprise,$7,400.00,2023-11-04,3.4%,true,280
SUB-1014,Zenith Analytics,Professional,$2,100.00,2023-11-20,8.1%,true,60
SUB-1015,Titan Security,Enterprise,$9,900.00,2023-12-05,0.8%,true,500`,
  },
  {
    id: "ecommerce-orders",
    name: "E-Commerce Global Transactions",
    fileName: "ecommerce_global_orders.csv",
    description: "Multi-region retail order transactions with currency, dates, quantities, and discount rates.",
    csvContent: `order_number,order_date,customer_segment,region,gross_sales,discount_rate,unit_quantity,delivery_status
ORD-9021,2024-01-02,Consumer,North America,$145.50,5.0%,3,Delivered
ORD-9022,2024-01-03,Corporate,Europe,$1,280.00,12.5%,18,Delivered
ORD-9023,2024-01-03,Small Business,Asia Pacific,$450.00,0.0%,5,In Transit
ORD-9024,2024-01-04,Consumer,North America,$89.99,10.0%,1,Delivered
ORD-9025,2024-01-05,Corporate,Latin America,$2,400.00,15.0%,32,Delivered
ORD-9026,2024-01-06,Consumer,Europe,$210.25,0.0%,2,Returned
ORD-9027,2024-01-07,Small Business,North America,$830.00,8.0%,10,Delivered
ORD-9028,2024-01-08,Consumer,Asia Pacific,$65.00,0.0%,1,In Transit
ORD-9029,2024-01-09,Corporate,North America,$3,150.00,20.0%,45,Delivered
ORD-9030,2024-01-10,Consumer,Europe,$199.95,5.0%,2,Delivered`,
  },
  {
    id: "ambiguous-test",
    name: "Ambiguous Mixed-Type Dataset (Constraint Verification)",
    fileName: "ambiguous_types_test.csv",
    description: "Specifically contains an ambiguous column with mixed incompatible types to verify the constraint.",
    csvContent: `record_id,transaction_date,customer_code,mixed_unclear_column,confirmed_amount
REC-01,2024-01-01,CUST-A,142.50,$500.00
REC-02,2024-01-02,CUST-B,Pending Review,$750.00
REC-03,2024-01-03,CUST-C,489.20,$1,200.00
REC-04,2024-01-04,CUST-D,N/A - Expedited,$350.00
REC-05,2024-01-05,CUST-E,2024-12-31,$890.00
REC-06,2024-01-06,CUST-F,True,$420.00
REC-07,2024-01-07,CUST-G,981.00,$610.00
REC-08,2024-01-08,CUST-H,System Error,$150.00`,
  },
];

/**
 * Creates a browser File instance from a dummy dataset definition.
 */
export function createDummyFile(dummy: DummyDatasetDefinition): File {
  const blob = new Blob([dummy.csvContent], { type: "text/csv;charset=utf-8;" });
  return new File([blob], dummy.fileName, { type: "text/csv" });
}
